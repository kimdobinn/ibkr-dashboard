import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartInterval, Candle } from "@/lib/api";
import { getChart } from "@/lib/api";

const INTERVALS: ChartInterval[] = ["1D", "1W", "1M", "3M", "1Y", "5Y"];

interface PriceChartProps {
  symbol: string;
  avgCost: number;
  currentPrice: number;
  pnlPercent: number;
  onClose: () => void;
  fmt: (n: number) => string;
}

function formatDate(timestamp: number, interval: ChartInterval): string {
  const d = new Date(timestamp * 1000);
  if (interval === "1D")
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (interval === "1W")
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { month: "short", day: "numeric", year: "2-digit" });
}

export function PriceChart({
  symbol,
  avgCost,
  currentPrice,
  fmt,
  pnlPercent,
  onClose,
}: PriceChartProps) {
  const [interval, setInterval] = useState<ChartInterval>("1M");
  const [data, setData] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getChart(symbol, interval)
      .then((candles) => {
        if (!cancelled) setData(candles);
      })
      .catch(() => {
        if (!cancelled) setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  const prices = data.map((c) => c.close);
  let minPrice = 0;
  let maxPrice = 100;
  if (prices.length) {
    const pMin = Math.min(...prices);
    const pMax = Math.max(...prices);
    const pRange = pMax - pMin || pMax * 0.02;
    minPrice = pMin - pRange * 0.05;
    maxPrice = pMax + pRange * 0.05;
  }

  const isAboveAvg = currentPrice >= avgCost;
  const lineColor = isAboveAvg ? "#34d399" : "#f87171";

  return (
    <div>
      {/* Chart header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-base font-medium text-muted-foreground mb-1">
            {symbol}
          </div>
          <div className="text-3xl font-bold tracking-tight">
            {fmt(currentPrice)}
          </div>
          <div
            className={`text-base font-medium mt-1 ${
              pnlPercent >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
            }`}
          >
            {pnlPercent >= 0 ? "+" : ""}
            {pnlPercent.toFixed(2)}% from avg
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors p-2 rounded-lg hover:bg-accent"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Chart area */}
      <div className="h-[300px] -mx-2">
        {loading ? (
          <div className="h-full flex items-center justify-center text-base text-muted-foreground">
            Loading...
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-base text-muted-foreground">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 10 }}>
              <defs>
                <linearGradient id={`grad-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={lineColor} stopOpacity={0.15} />
                  <stop offset="100%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="time"
                tickFormatter={(t: number) => formatDate(t, interval)}
                tick={{ fill: "var(--color-muted-foreground)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                minTickGap={60}
              />
              <YAxis domain={[minPrice, maxPrice]} hide />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: "12px",
                  padding: "10px 14px",
                  color: "var(--color-foreground)",
                  fontSize: "14px",
                }}
                labelFormatter={(t) => formatDate(Number(t), interval)}
                formatter={(value) => [fmt(Number(value)), ""]}
              />
              <ReferenceLine
                y={avgCost}
                stroke="#a1a1aa"
                strokeWidth={1}
                label={{
                  value: `avg ${fmt(avgCost)}`,
                  position: "insideTopRight",
                  fill: "#a1a1aa",
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={lineColor}
                strokeWidth={2}
                fill={`url(#grad-${symbol})`}
                dot={false}
                activeDot={{ r: 5, fill: lineColor, strokeWidth: 0 }}
                animationDuration={750}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Interval tabs */}
      <div className="flex justify-center gap-1.5 mt-5">
        {INTERVALS.map((iv) => (
          <button
            key={iv}
            onClick={() => setInterval(iv)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              interval === iv
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
            }`}
          >
            {iv}
          </button>
        ))}
      </div>
    </div>
  );
}
