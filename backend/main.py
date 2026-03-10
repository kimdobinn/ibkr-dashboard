from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
from contextlib import asynccontextmanager

import httpx
import websockets
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import StreamingResponse

load_dotenv()
logger = logging.getLogger("uvicorn.error")

FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")
TWELVEDATA_API_KEY = os.getenv("TWELVEDATA_API_KEY", "")
IBKR_GATEWAY_URL = os.getenv("IBKR_GATEWAY_URL", "https://localhost:5000")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# IBKR gateway uses self-signed certs
ibkr_ssl_ctx = ssl.create_default_context()
ibkr_ssl_ctx.check_hostname = False
ibkr_ssl_ctx.verify_mode = ssl.CERT_NONE

ibkr_session_alive = False
tickle_task: asyncio.Task[None] | None = None


# ── Finnhub WebSocket Manager ────────────────────────────────────────────────

class FinnhubStream:
    """Manages a persistent WebSocket connection to Finnhub for real-time trades."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.ws: websockets.WebSocketClientProtocol | None = None
        self.subscribed: set[str] = set()
        self.latest_prices: dict[str, float] = {}
        self._listeners: list[asyncio.Queue[dict]] = []
        self._task: asyncio.Task[None] | None = None

    async def start(self):
        self._task = asyncio.create_task(self._run_forever())

    async def stop(self):
        if self._task:
            self._task.cancel()
        if self.ws:
            await self.ws.close()

    async def _run_forever(self):
        """Connect and reconnect to Finnhub WebSocket indefinitely."""
        while True:
            try:
                url = f"wss://ws.finnhub.io?token={self.api_key}"
                async with websockets.connect(url) as ws:
                    self.ws = ws
                    logger.info("Finnhub WebSocket connected")

                    # Resubscribe to all symbols on reconnect
                    for sym in self.subscribed:
                        await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))

                    async for msg in ws:
                        data = json.loads(msg)
                        if data.get("type") == "trade":
                            for trade in data.get("data", []):
                                symbol = trade["s"]
                                price = trade["p"]
                                self.latest_prices[symbol] = price
                                event = {"symbol": symbol, "price": price, "timestamp": trade["t"]}
                                for q in self._listeners:
                                    try:
                                        q.put_nowait(event)
                                    except asyncio.QueueFull:
                                        pass  # drop if listener is slow

            except (websockets.ConnectionClosed, Exception) as e:
                logger.warning(f"Finnhub WS disconnected: {e}. Reconnecting in 5s...")
                self.ws = None
                await asyncio.sleep(5)

    async def subscribe(self, symbols: list[str]):
        """Subscribe to new symbols."""
        new_syms = set(s.upper() for s in symbols) - self.subscribed
        if not new_syms:
            return
        self.subscribed.update(new_syms)
        if self.ws:
            for sym in new_syms:
                await self.ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
                logger.info(f"Subscribed to {sym}")

    def add_listener(self) -> asyncio.Queue[dict]:
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
        self._listeners.append(q)
        return q

    def remove_listener(self, q: asyncio.Queue[dict]):
        self._listeners.remove(q)


finnhub_stream = FinnhubStream(FINNHUB_API_KEY)


# ── IBKR Tickle ──────────────────────────────────────────────────────────────

async def tickle_ibkr() -> None:
    global ibkr_session_alive
    async with httpx.AsyncClient(verify=ibkr_ssl_ctx) as client:
        while True:
            try:
                resp = await client.post(
                    f"{IBKR_GATEWAY_URL}/v1/api/tickle", timeout=10
                )
                ibkr_session_alive = resp.status_code == 200
            except Exception:
                ibkr_session_alive = False
            await asyncio.sleep(55)


# ── Lifespan ─────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(_app: FastAPI):
    global tickle_task
    tickle_task = asyncio.create_task(tickle_ibkr())
    await finnhub_stream.start()
    yield
    tickle_task.cancel()
    await finnhub_stream.stop()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://localhost:5174", "https://dobin-portfolio.vercel.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── IBKR Status ──────────────────────────────────────────────────────────────


@app.get("/api/ibkr/status")
async def ibkr_status():
    if not ibkr_session_alive:
        return {"connected": False, "username": None, "accountId": None}

    username = None
    account_id = None
    async with httpx.AsyncClient(verify=ibkr_ssl_ctx) as client:
        try:
            resp = await client.get(
                f"{IBKR_GATEWAY_URL}/v1/api/portfolio/accounts", timeout=5
            )
            if resp.status_code == 200:
                accounts = resp.json()
                if accounts:
                    account_id = accounts[0].get("accountId") or accounts[0].get("id")
                    username = accounts[0].get("accountTitle") or account_id
        except Exception:
            pass

    return {"connected": True, "username": username, "accountId": account_id}


# ── IBKR Holdings ────────────────────────────────────────────────────────────


@app.get("/api/ibkr/holdings")
async def ibkr_holdings():
    async with httpx.AsyncClient(verify=ibkr_ssl_ctx) as client:
        try:
            accts_resp = await client.get(
                f"{IBKR_GATEWAY_URL}/v1/api/portfolio/accounts", timeout=10
            )
            accts_resp.raise_for_status()
            accounts = accts_resp.json()
            if not accounts:
                raise HTTPException(status_code=502, detail="No IBKR accounts found")

            account_id = accounts[0].get("accountId") or accounts[0].get("id")

            pos_resp = await client.get(
                f"{IBKR_GATEWAY_URL}/v1/api/portfolio/{account_id}/positions/0",
                timeout=15,
            )
            pos_resp.raise_for_status()
            positions = pos_resp.json()

            holdings = []
            for pos in positions:
                ticker = pos.get("ticker") or pos.get("contractDesc", "")
                if not ticker:
                    continue
                ticker = ticker.split(" ")[0].upper()
                holdings.append(
                    {
                        "ticker": ticker,
                        "shares": pos.get("position", 0),
                        "avg_cost": pos.get("avgCost", 0),
                    }
                )

            return {"holdings": holdings}

        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=502, detail=f"IBKR gateway error: {str(e)}"
            )


# ── Market Data: Price Quote ─────────────────────────────────────────────────


@app.get("/api/quote")
async def get_quote(symbol: str = Query(...)):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://finnhub.io/api/v1/quote",
            params={"symbol": symbol.upper(), "token": FINNHUB_API_KEY},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        return {
            "current": data.get("c", 0),
            "change": data.get("d", 0),
            "changePercent": data.get("dp", 0),
            "high": data.get("h", 0),
            "low": data.get("l", 0),
            "open": data.get("o", 0),
            "previousClose": data.get("pc", 0),
        }


# ── Market Data: Batch Quotes ────────────────────────────────────────────────


@app.get("/api/quotes")
async def get_quotes(symbols: str = Query(..., description="Comma-separated tickers")):
    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()]

    async with httpx.AsyncClient() as client:

        async def fetch_one(symbol: str):
            try:
                resp = await client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": symbol, "token": FINNHUB_API_KEY},
                    timeout=10,
                )
                resp.raise_for_status()
                d = resp.json()
                return symbol, {
                    "current": d.get("c", 0),
                    "change": d.get("d", 0),
                    "changePercent": d.get("dp", 0),
                }
            except Exception:
                return symbol, None

        results = await asyncio.gather(*[fetch_one(t) for t in tickers])
        return {sym: data for sym, data in results if data is not None}


# ── Real-time Price Stream (SSE) ─────────────────────────────────────────────


@app.get("/api/prices/stream")
async def price_stream(
    request: Request,
    symbols: str = Query(..., description="Comma-separated tickers to stream"),
):
    """Server-Sent Events endpoint for real-time price updates."""
    tickers = [s.strip().upper() for s in symbols.split(",") if s.strip()]

    # Subscribe to these symbols on Finnhub WebSocket
    await finnhub_stream.subscribe(tickers)

    ticker_set = set(tickers)

    async def event_generator():
        queue = finnhub_stream.add_listener()
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    if event["symbol"] in ticker_set:
                        yield f"data: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    # Send keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
        finally:
            finnhub_stream.remove_listener(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── Market Data: Chart ────────────────────────────────────────────────────────

TWELVEDATA_INTERVALS = {
    "1D": ("5min", 78),
    "1W": ("30min", 65),
    "1M": ("1h", 155),
    "3M": ("1day", 63),
    "1Y": ("1day", 252),
    "5Y": ("1week", 260),
}


@app.get("/api/chart")
async def get_chart(
    symbol: str = Query(...),
    interval: str = Query("1M"),
):
    symbol = symbol.upper()
    return await _chart_twelvedata(symbol, interval)


async def _chart_twelvedata(symbol: str, interval: str = "5Y"):
    if interval not in TWELVEDATA_INTERVALS:
        raise HTTPException(status_code=400, detail=f"Invalid interval: {interval}")

    td_interval, outputsize = TWELVEDATA_INTERVALS[interval]

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://api.twelvedata.com/time_series",
            params={
                "symbol": symbol,
                "interval": td_interval,
                "outputsize": outputsize,
                "apikey": TWELVEDATA_API_KEY,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        values = data.get("values", [])
        if not values:
            return []

        from datetime import datetime

        candles = []
        for v in reversed(values):
            raw = v["datetime"]
            try:
                dt = datetime.strptime(raw, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                dt = datetime.strptime(raw, "%Y-%m-%d")
            candles.append(
                {
                    "time": int(dt.timestamp()),
                    "open": float(v["open"]),
                    "high": float(v["high"]),
                    "low": float(v["low"]),
                    "close": float(v["close"]),
                    "volume": int(v["volume"]),
                }
            )
        return candles
