import type { VercelRequest, VercelResponse } from "@vercel/node";

const INTERVALS: Record<string, { interval: string; outputsize: number }> = {
  "1D": { interval: "5min", outputsize: 78 },
  "1W": { interval: "30min", outputsize: 65 },
  "1M": { interval: "1h", outputsize: 155 },
  "3M": { interval: "1day", outputsize: 63 },
  "1Y": { interval: "1day", outputsize: 252 },
  "5Y": { interval: "1week", outputsize: 260 },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const symbol = ((req.query.symbol as string) || "").toUpperCase();
  const interval = (req.query.interval as string) || "1M";

  if (!symbol) {
    return res.status(400).json({ error: "No symbol provided" });
  }

  const config = INTERVALS[interval];
  if (!config) {
    return res.status(400).json({ error: `Invalid interval: ${interval}` });
  }

  const apiKey = process.env.TWELVEDATA_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "TWELVEDATA_API_KEY not configured" });
  }

  try {
    const resp = await fetch(
      `https://api.twelvedata.com/time_series?symbol=${symbol}&interval=${config.interval}&outputsize=${config.outputsize}&apikey=${apiKey}`
    );
    const data = await resp.json();
    const values = data.values || [];

    if (!values.length) {
      return res.json([]);
    }

    const candles = [];
    for (let i = values.length - 1; i >= 0; i--) {
      const v = values[i];
      const raw = v.datetime as string;
      // Parse "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD"
      const dt = new Date(raw.includes(" ") ? raw.replace(" ", "T") : raw + "T00:00:00");
      candles.push({
        time: Math.floor(dt.getTime() / 1000),
        open: parseFloat(v.open),
        high: parseFloat(v.high),
        low: parseFloat(v.low),
        close: parseFloat(v.close),
        volume: parseInt(v.volume, 10),
      });
    }

    // Cache chart data for a bit
    const maxAge = interval === "1D" ? 60 : interval === "1W" ? 300 : 3600;
    res.setHeader("Cache-Control", `s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 2}`);
    return res.json(candles);
  } catch (err) {
    return res.status(502).json({ error: "Failed to fetch chart data" });
  }
}
