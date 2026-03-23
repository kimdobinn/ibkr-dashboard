const API_BASE = "/api";

async function fetchJson<T>(url: string): Promise<T> {
  const resp = await fetch(`${API_BASE}${url}`);
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json() as Promise<T>;
}

export interface Quote {
  current: number;
  change: number;
  changePercent: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type ChartInterval = "1D" | "1W" | "1M" | "3M" | "1Y" | "5Y";

export function getQuotes(
  symbols: string[]
): Promise<Record<string, Quote>> {
  return fetchJson(`/quotes?symbols=${symbols.join(",")}`);
}

const chartCache = new Map<string, Candle[]>();

export function getChart(
  symbol: string,
  interval: ChartInterval
): Promise<Candle[]> {
  const key = `${symbol}-${interval}`;
  const cached = chartCache.get(key);
  if (cached) return Promise.resolve(cached);

  return fetchJson<Candle[]>(`/chart?symbol=${symbol}&interval=${interval}`).then(
    (data) => {
      chartCache.set(key, data);
      return data;
    }
  );
}

// IBKR functions — call localhost:8000 directly so they work from the deployed site too

const IBKR_BASE = "http://localhost:8000/api";

async function fetchIbkr<T>(path: string): Promise<T> {
  const resp = await fetch(`${IBKR_BASE}${path}`);
  if (!resp.ok) throw new Error(`IBKR API error: ${resp.status}`);
  return resp.json() as Promise<T>;
}

export interface IbkrStatus {
  connected: boolean;
  username: string | null;
  accountId: string | null;
}

export function getIbkrStatus(): Promise<IbkrStatus> {
  return fetchIbkr("/ibkr/status");
}

export interface IbkrHolding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

export function getIbkrHoldings(): Promise<{ holdings: IbkrHolding[] }> {
  return fetchIbkr("/ibkr/holdings");
}

// Toss Securities sync — also calls localhost:8000 (Playwright runs locally)

export interface TossHolding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

export async function syncTossHoldings(
  name: string,
  birthday: string,
  phone: string
): Promise<{ holdings: TossHolding[] }> {
  const resp = await fetch(`${IBKR_BASE}/toss/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, birthday, phone }),
    signal: AbortSignal.timeout(180_000), // 3 min timeout for phone approval
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Toss sync error: ${resp.status}`);
  }
  return resp.json();
}
