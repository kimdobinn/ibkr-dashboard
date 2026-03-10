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

// IBKR functions — only work when Python backend is running locally

export interface IbkrStatus {
  connected: boolean;
  username: string | null;
  accountId: string | null;
}

export function getIbkrStatus(): Promise<IbkrStatus> {
  return fetchJson("/ibkr/status");
}

export interface IbkrHolding {
  ticker: string;
  shares: number;
  avg_cost: number;
}

export function getIbkrHoldings(): Promise<{ holdings: IbkrHolding[] }> {
  return fetchJson("/ibkr/holdings");
}
