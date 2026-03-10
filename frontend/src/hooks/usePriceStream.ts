import { useEffect, useRef } from "react";

interface PriceUpdate {
  symbol: string;
  price: number;
  timestamp: number;
}

const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_API_KEY || "";

export function usePriceStream(
  symbols: string[],
  onUpdate: (update: PriceUpdate) => void
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  useEffect(() => {
    if (symbols.length === 0 || !FINNHUB_KEY) return;

    const ws = new WebSocket(`wss://ws.finnhub.io?token=${FINNHUB_KEY}`);

    ws.onopen = () => {
      for (const sym of symbols) {
        ws.send(JSON.stringify({ type: "subscribe", symbol: sym }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "trade" && msg.data) {
          for (const trade of msg.data) {
            onUpdateRef.current({
              symbol: trade.s,
              price: trade.p,
              timestamp: trade.t,
            });
          }
        }
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      // will reconnect via cleanup + re-effect
    };

    return () => ws.close();
  }, [symbols.join(",")]);
}
