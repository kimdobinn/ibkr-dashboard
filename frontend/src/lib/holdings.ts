import { supabase } from "./supabase";

export interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avg_cost: number;
  source: "ibkr" | "manual";
}

export async function getHoldings(): Promise<Holding[]> {
  const { data, error } = await supabase
    .from("holdings")
    .select("id, ticker, shares, avg_cost, source")
    .order("ticker");
  if (error) throw error;
  return data as Holding[];
}

export async function upsertHoldings(
  holdings: { ticker: string; shares: number; avg_cost: number; source: "ibkr" | "manual" }[],
  userId: string
) {
  const rows = holdings.map((h) => ({
    user_id: userId,
    ticker: h.ticker.toUpperCase(),
    shares: h.shares,
    avg_cost: h.avg_cost,
    source: h.source,
  }));

  const { error } = await supabase
    .from("holdings")
    .upsert(rows, { onConflict: "user_id,ticker,source" });
  if (error) throw error;
}

export async function deleteHolding(id: string) {
  const { error } = await supabase.from("holdings").delete().eq("id", id);
  if (error) throw error;
}

export async function addManualHolding(
  userId: string,
  ticker: string,
  shares: number,
  avgCost: number
) {
  const { error } = await supabase.from("holdings").upsert(
    {
      user_id: userId,
      ticker: ticker.toUpperCase(),
      shares,
      avg_cost: avgCost,
      source: "manual",
    },
    { onConflict: "user_id,ticker,source" }
  );
  if (error) throw error;
}
