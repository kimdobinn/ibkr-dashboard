import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const symbols = (req.query.symbols as string || "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    return res.status(400).json({ error: "No symbols provided" });
  }

  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "FINNHUB_API_KEY not configured" });
  }

  const results: Record<string, unknown> = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        const resp = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`
        );
        if (!resp.ok) return;
        const d = await resp.json();
        results[symbol] = {
          current: d.c ?? 0,
          change: d.d ?? 0,
          changePercent: d.dp ?? 0,
        };
      } catch {
        // skip failed symbols
      }
    })
  );

  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=50");
  return res.json(results);
}
