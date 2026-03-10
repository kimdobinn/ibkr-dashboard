import { useCallback, useEffect, useState, useMemo, memo } from "react";
import type { User } from "@supabase/supabase-js";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PriceChart } from "./PriceChart";
import { AddHoldingDialog } from "./AddHoldingDialog";
import { IbkrInstructionsDialog } from "./IbkrInstructionsDialog";
import { usePriceStream } from "@/hooks/usePriceStream";
import type { Holding } from "@/lib/holdings";
import {
  getHoldings,
  addManualHolding,
  deleteHolding,
  upsertHoldings,
} from "@/lib/holdings";
import type { Quote } from "@/lib/api";
import { getQuotes, getIbkrHoldings, getIbkrStatus } from "@/lib/api";
import { getPreferences, savePreferences } from "@/lib/preferences";

function formatTimeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

interface DashboardProps {
  user: User;
  onSignOut: () => void;
}

interface EnrichedHolding extends Holding {
  currentPrice: number;
  value: number;
  pnl: number;
  pnlPercent: number;
}

interface ExchangeRates {
  SGD: number;
  KRW: number;
  SGD_KRW: number;
}

function useExchangeRates(): ExchangeRates | null {
  const [rates, setRates] = useState<ExchangeRates | null>(null);
  useEffect(() => {
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((data) => {
        const sgd = data.rates?.SGD ?? 0;
        const krw = data.rates?.KRW ?? 0;
        setRates({ SGD: sgd, KRW: krw, SGD_KRW: sgd > 0 ? krw / sgd : 0 });
      })
      .catch(() => {});
  }, []);
  return rates;
}

function useTheme(onChanged?: (theme: string) => void) {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("theme", next ? "dark" : "light");
    onChanged?.(next ? "dark" : "light");
  };
  const setTheme = (t: string) => {
    const d = t === "dark";
    setDark(d);
    document.documentElement.classList.toggle("dark", d);
    localStorage.setItem("theme", t);
  };
  return { dark, toggle, setTheme };
}

type Currency = "USD" | "SGD" | "KRW";
type DisplayMode = "price" | "value";
type SortField = "pnl" | "value" | "custom";
type SortDir = "asc" | "desc";

const SORT_FIELDS: { field: SortField; label: string }[] = [
  { field: "value", label: "Value" },
  { field: "pnl", label: "Profit" },
  { field: "custom", label: "Custom" },
];

const TimeAgo = memo(function TimeAgo({ date }: { date: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  let text: string;
  if (seconds < 60) text = `${seconds}s ago`;
  else if (seconds < 3600) text = `${Math.floor(seconds / 60)}m ago`;
  else text = `${Math.floor(seconds / 3600)}h ago`;
  return <span>Updated {text}</span>;
});

// ── Reusable toggle group ──

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex bg-secondary/60 rounded-lg p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
            value === o.value
              ? "bg-foreground text-background shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Sortable exchange rate row ──

interface RateRowItem {
  id: string;
  label: string;
}

function SortableRateRow({ item }: { item: RateRowItem }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 text-sm text-muted-foreground leading-relaxed"
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors"
      >
        ⠿
      </span>
      <span>{item.label}</span>
    </div>
  );
}

// ── Sortable holding row ──

interface SortableHoldingRowProps {
  holding: EnrichedHolding;
  isSelected: boolean;
  displayMode: DisplayMode;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  fmt: (n: number) => string;
  fmtSign: (n: number) => string;
  fmtPct: (n: number) => string;
  clr: (n: number) => string;
  isDragSort: boolean;
}

function SortableHoldingRow({
  holding: h,
  isSelected,
  displayMode,
  onSelect,
  onDelete,
  fmt,
  fmtSign,
  fmtPct,
  clr,
  isDragSort,
}: SortableHoldingRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: h.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-center gap-4 py-4 px-4 rounded-2xl cursor-pointer transition-all ${
        isSelected
          ? "bg-accent/70 ring-1 ring-border"
          : "hover:bg-accent/40"
      }`}
    >
      {isDragSort && (
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-muted-foreground transition-colors shrink-0 text-base"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>
      )}

      {/* Left — ticker + subtitle */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-base">{h.ticker}</span>
          {h.source === "manual" && (
            <span className="text-[11px] text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
              manual
            </span>
          )}
        </div>
        <div className="text-sm text-muted-foreground mt-1 leading-relaxed">
          {displayMode === "value"
            ? `${h.shares} shares`
            : `avg ${fmt(h.avg_cost)}`}
        </div>
      </div>

      {/* Right — value/price + P&L */}
      <div className="text-right shrink-0 flex items-center gap-3">
        <div>
          <div className="font-semibold text-base">
            {displayMode === "value" ? fmt(h.value) : fmt(h.currentPrice)}
          </div>
          <div className={`text-sm mt-0.5 ${clr(h.pnl)}`}>
            {displayMode === "value"
              ? `${fmtSign(h.pnl)} (${Math.abs(h.pnlPercent).toFixed(1)}%)`
              : fmtPct(h.pnlPercent)}
          </div>
        </div>
        {h.source === "manual" && (
          <button
            onClick={onDelete}
            className="text-muted-foreground hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-destructive/10"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sun / Moon icon ──

function ThemeIcon({ dark }: { dark: boolean }) {
  if (dark) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ── Dashboard ──
// ════════════════════════════════════════════════════════════════════════════

export function Dashboard({ user, onSignOut }: DashboardProps) {
  const rates = useExchangeRates();
  const [, setPrefsLoaded] = useState(false);
  const [currency, setCurrency] = useState<Currency>("USD");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("value");
  const [holdings, setHoldings] = useState<EnrichedHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshingIbkr, setRefreshingIbkr] = useState(false);
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ibkrUsername, setIbkrUsername] = useState<string | null>(null);
  const [lastIbkrSync, setLastIbkrSync] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>("value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [holdingOrder, setHoldingOrder] = useState<string[]>([]);
  const [rateOrder, setRateOrder] = useState<string[]>(["usd_sgd", "usd_krw", "sgd_krw"]);

  const save = useCallback(
    (prefs: Record<string, unknown>) => savePreferences(user.id, prefs),
    [user.id]
  );

  const theme = useTheme((t) => save({ theme: t }));

  // Load preferences from Supabase on mount
  useEffect(() => {
    getPreferences(user.id).then((p) => {
      setCurrency(p.currency as Currency);
      setDisplayMode(p.display_mode as DisplayMode);
      setSortField(p.sort_field as SortField);
      setSortDir(p.sort_dir as SortDir);
      setHoldingOrder(p.holding_order);
      setRateOrder(p.rate_order);
      theme.setTheme(p.theme);
      setLastIbkrSync(p.last_ibkr_sync);
      setPrefsLoaded(true);
    });
  }, [user.id]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const cRate = currency === "USD" ? 1 : currency === "SGD" ? (rates?.SGD ?? 1) : (rates?.KRW ?? 1);
  const cPrefix = currency + " ";
  const cDecimals = currency === "KRW" ? 0 : 2;

  // ── Data loading ──

  const loadHoldings = useCallback(async () => {
    try {
      const rawHoldings = await getHoldings();
      if (rawHoldings.length === 0) {
        setHoldings([]);
        setLoading(false);
        return;
      }
      const tickers = rawHoldings.map((h) => h.ticker);
      const quotes = await getQuotes(tickers);
      const enriched: EnrichedHolding[] = rawHoldings.map((h) => {
        const q: Quote | undefined = quotes[h.ticker];
        const currentPrice = q?.current ?? 0;
        const value = h.shares * currentPrice;
        const pnl = h.shares * (currentPrice - h.avg_cost);
        const pnlPercent =
          h.avg_cost > 0 ? ((currentPrice - h.avg_cost) / h.avg_cost) * 100 : 0;
        return { ...h, currentPrice, value, pnl, pnlPercent };
      });
      setHoldings(enriched);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to load holdings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHoldings();
    const id = setInterval(loadHoldings, 62_000);
    return () => clearInterval(id);
  }, [loadHoldings]);

  // Fetch IBKR username
  useEffect(() => {
    getIbkrStatus()
      .then((s) => setIbkrUsername(s.username))
      .catch(() => {});
  }, []);

  const streamSymbols = useMemo(
    () => holdings.map((h) => h.ticker),
    [holdings.map((h) => h.ticker).join(",")]
  );

  usePriceStream(streamSymbols, (update) => {
    setHoldings((prev) =>
      prev.map((h) => {
        if (h.ticker !== update.symbol) return h;
        const currentPrice = update.price;
        const value = h.shares * currentPrice;
        const pnl = h.shares * (currentPrice - h.avg_cost);
        const pnlPercent =
          h.avg_cost > 0 ? ((currentPrice - h.avg_cost) / h.avg_cost) * 100 : 0;
        return { ...h, currentPrice, value, pnl, pnlPercent };
      })
    );
    setLastRefresh(new Date());
  });

  // ── Computed values ──

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.shares * h.avg_cost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  useEffect(() => {
    setHoldingOrder((prev) => {
      const currentIds = new Set(holdings.map((h) => h.id));
      const filtered = prev.filter((id) => currentIds.has(id));
      const newIds = holdings.map((h) => h.id).filter((id) => !new Set(filtered).has(id));
      return [...filtered, ...newIds];
    });
  }, [holdings.map((h) => h.id).join(",")]);

  const sortedHoldings = useMemo(() => {
    if (sortField === "custom") {
      const map = new Map(holdings.map((h) => [h.id, h]));
      return holdingOrder
        .map((id) => map.get(id))
        .filter((h): h is EnrichedHolding => h !== undefined);
    }
    const sorted = [...holdings];
    const m = sortDir === "desc" ? -1 : 1;
    switch (sortField) {
      case "pnl":
        sorted.sort((a, b) => (a.pnl - b.pnl) * m);
        break;
      case "value":
        sorted.sort((a, b) => (a.value - b.value) * m);
        break;
    }
    return sorted;
  }, [holdings, sortField, sortDir, holdingOrder]);

  const rateRows: RateRowItem[] = useMemo(() => {
    if (!rates) return [];
    const all: Record<string, RateRowItem> = {
      usd_sgd: { id: "usd_sgd", label: `1 USD = ${rates.SGD.toFixed(2)} SGD` },
      usd_krw: { id: "usd_krw", label: `1 USD = ${rates.KRW.toLocaleString("en-US", { maximumFractionDigits: 0 })} KRW` },
      sgd_krw: { id: "sgd_krw", label: `1 SGD = ${rates.SGD_KRW.toLocaleString("en-US", { maximumFractionDigits: 0 })} KRW` },
    };
    return rateOrder.map((id) => all[id]).filter(Boolean);
  }, [rates, rateOrder]);

  // ── Handlers ──

  const handleRateDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setRateOrder((prev) => {
        const next = arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string));
        save({ rate_order: next });
        return next;
      });
    }
  };

  const handleHoldingDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setHoldingOrder((prev) => {
        const next = arrayMove(prev, prev.indexOf(active.id as string), prev.indexOf(over.id as string));
        save({ holding_order: next });
        return next;
      });
    }
  };

  const handleRefreshIbkr = async () => {
    try {
      const status = await getIbkrStatus();
      if (!status.connected) return;
    } catch {
      return;
    }
    setRefreshingIbkr(true);
    setError(null);
    try {
      const { holdings: ibkrHoldings } = await getIbkrHoldings();
      await upsertHoldings(
        ibkrHoldings.map((h) => ({ ...h, source: "ibkr" as const })),
        user.id
      );
      const now = new Date().toISOString();
      setLastIbkrSync(now);
      save({ last_ibkr_sync: now });
      await loadHoldings();
    } catch {
      setError("Failed to sync from IBKR. Make sure the gateway is running and authenticated.");
    } finally {
      setRefreshingIbkr(false);
    }
  };

  const handleAddManual = async (ticker: string, shares: number, avgCost: number) => {
    await addManualHolding(user.id, ticker, shares, avgCost);
    await loadHoldings();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteHolding(id);
    if (selectedTicker) setSelectedTicker(null);
    await loadHoldings();
  };

  const selectedHolding = holdings.find((h) => h.ticker === selectedTicker);

  // ── Formatters ──

  const fmt = (n: number) => {
    const converted = n * cRate;
    return cPrefix + converted.toLocaleString("en-US", {
      minimumFractionDigits: cDecimals,
      maximumFractionDigits: cDecimals,
    });
  };
  const fmtSign = (n: number) => (n >= 0 ? "+" : "") + fmt(n);
  const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
  const clr = (n: number) => (n >= 0 ? "text-emerald-500 dark:text-emerald-400" : "text-red-500 dark:text-red-400");

  // ════════════════════════════════════════════════════════════════════════
  // ── Render ──
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Top bar ── */}
      <header className="border-b border-border">
        <div className="flex items-center justify-between px-12 lg:px-24 py-4">
          <h1 className="text-lg font-semibold tracking-tight">
            {ibkrUsername ?? user.user_metadata?.full_name ?? user.email ?? "Portfolio"}
          </h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setInstructionsOpen(true)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-accent"
              title="IBKR Sync Instructions"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <path d="M12 17h.01" />
              </svg>
            </button>
            <button
              onClick={handleRefreshIbkr}
              disabled={refreshingIbkr}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              {refreshingIbkr ? "Syncing..." : "IBKR Sync"}
            </button>
            <button
              onClick={() => setAddDialogOpen(true)}
              className="text-sm font-medium bg-foreground text-background px-4 py-1.5 rounded-lg hover:opacity-90 transition-opacity"
            >
              + Add
            </button>
            <div className="w-px h-5 bg-border" />
            <button
              onClick={theme.toggle}
              className="text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-lg hover:bg-accent"
            >
              <ThemeIcon dark={theme.dark} />
            </button>
            <button
              onClick={onSignOut}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* ── Summary section ── */}
      <section className="px-12 lg:px-24 pt-8 pb-6 border-b border-border">
        <div className="text-5xl font-bold tracking-tight leading-tight">
          {fmt(totalValue)}
        </div>
        <div className={`text-lg font-medium mt-2 ${clr(totalPnl)}`}>
          {fmtSign(totalPnl)} ({fmtPct(totalPnlPercent)})
        </div>

        <div className="flex items-center gap-3 mt-4 text-sm text-muted-foreground">
          {lastRefresh && (
            <>
              <TimeAgo date={lastRefresh} />
              <span className="text-border">|</span>
              <button
                onClick={loadHoldings}
                className="hover:text-foreground transition-colors underline underline-offset-4"
              >
                Refresh
              </button>
              <span className="text-border">|</span>
            </>
          )}
          <span>US market Mon–Fri 9:30 PM – 4:00 AM SGT</span>
          {lastIbkrSync && (
            <>
              <span className="text-border">|</span>
              <span>IBKR synced {formatTimeAgo(lastIbkrSync)}</span>
            </>
          )}
        </div>

        {/* Exchange rates */}
        {rateRows.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRateDragEnd}>
            <SortableContext items={rateRows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-0.5 mt-4">
                {rateRows.map((row) => (
                  <SortableRateRow key={row.id} item={row} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </section>

      {/* ── Controls bar ── */}
      <div className="px-12 lg:px-24 py-4 border-b border-border bg-secondary/20">
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {SORT_FIELDS.map(({ field, label }) => {
              const isActive = sortField === field;
              return (
                <button
                  key={field}
                  onClick={() => {
                    if (field === "custom") {
                      setSortField("custom");
                      save({ sort_field: "custom" });
                    } else if (isActive) {
                      const next = sortDir === "desc" ? "asc" : "desc";
                      setSortDir(next);
                      save({ sort_dir: next });
                    } else {
                      setSortField(field);
                      setSortDir("desc");
                      save({ sort_field: field, sort_dir: "desc" });
                    }
                  }}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    isActive
                      ? "bg-foreground text-background shadow-sm"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  {label}
                  {isActive && field !== "custom" && (
                    <span className="ml-1">{sortDir === "desc" ? "↓" : "↑"}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3">
            <ToggleGroup
              options={[
                { value: "price" as DisplayMode, label: "Price" },
                { value: "value" as DisplayMode, label: "Value" },
              ]}
              value={displayMode}
              onChange={(v) => { setDisplayMode(v); save({ display_mode: v }); }}
            />
            <ToggleGroup
              options={[
                { value: "USD" as Currency, label: "USD" },
                { value: "SGD" as Currency, label: "SGD" },
                { value: "KRW" as Currency, label: "KRW" },
              ]}
              value={currency}
              onChange={(v) => { setCurrency(v); save({ currency: v }); }}
            />
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-12 lg:px-24 pt-4">
          <div className="bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-300 text-sm rounded-xl px-5 py-3.5">
            {error}
          </div>
        </div>
      )}

      {/* ── Main content: Holdings + Chart ── */}
      <main className="px-12 lg:px-24 py-6 pb-24">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(400px,1fr)_minmax(0,1.5fr)] gap-8">
          {/* Holdings list */}
          <div>
            {loading ? (
              <div className="py-20 text-center text-base text-muted-foreground">
                Loading...
              </div>
            ) : holdings.length === 0 ? (
              <div className="py-20 text-center text-base text-muted-foreground">
                No holdings yet. Add manually or sync from IBKR.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleHoldingDragEnd}>
                <SortableContext items={sortedHoldings.map((h) => h.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {sortedHoldings.map((h) => (
                      <SortableHoldingRow
                        key={h.id}
                        holding={h}
                        isSelected={selectedTicker === h.ticker}
                        displayMode={displayMode}
                        onSelect={() =>
                          setSelectedTicker(selectedTicker === h.ticker ? null : h.ticker)
                        }
                        onDelete={(e) => handleDelete(h.id, e)}
                        fmt={fmt}
                        fmtSign={fmtSign}
                        fmtPct={fmtPct}
                        clr={clr}
                        isDragSort={sortField === "custom"}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </div>

          {/* Chart panel */}
          <div>
            {selectedHolding ? (
              <div className="sticky top-6 bg-card border border-border rounded-2xl p-6">
                <PriceChart
                  symbol={selectedHolding.ticker}
                  avgCost={selectedHolding.avg_cost}
                  currentPrice={selectedHolding.currentPrice}
                  pnlPercent={selectedHolding.pnlPercent}
                  onClose={() => setSelectedTicker(null)}
                  fmt={fmt}
                />
              </div>
            ) : (
              <div className="sticky top-6 flex items-center justify-center h-[420px] text-base text-muted-foreground rounded-2xl border border-dashed border-border">
                Select a holding to view chart
              </div>
            )}
          </div>
        </div>
      </main>

      <AddHoldingDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddManual}
      />
      <IbkrInstructionsDialog
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
      />
    </div>
  );
}
