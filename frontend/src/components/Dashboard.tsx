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
import { TossSyncDialog } from "./TossSyncDialog";
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
import { getQuotes, getIbkrHoldings, getIbkrStatus, syncTossHoldings } from "@/lib/api";
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

const TimeAgo = memo(function TimeAgo({ date }: { date: Date }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  let text: string;
  if (seconds < 60) text = `${seconds}s`;
  else if (seconds < 3600) text = `${Math.floor(seconds / 60)}m`;
  else text = `${Math.floor(seconds / 3600)}h`;
  return <span>{text}</span>;
});

// ── Holding row ──

function HoldingRow({
  holding: h,
  isSelected,
  displayMode,
  onSelect,
  onDelete,
  fmt,
  fmtSign,
  clr,
}: {
  holding: EnrichedHolding;
  isSelected: boolean;
  displayMode: DisplayMode;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  fmt: (n: number) => string;
  fmtSign: (n: number) => string;
  clr: (n: number) => string;
}) {
  return (
    <div
      onClick={onSelect}
      className={`group flex items-center gap-3 py-2.5 px-3 cursor-pointer transition-colors rounded-lg ${
        isSelected
          ? "bg-foreground/[0.06]"
          : "hover:bg-foreground/[0.03]"
      }`}
    >
      {/* Logo + Ticker */}
      <div className="w-20 shrink-0 flex items-center gap-2">
        {h.logo_url ? (
          <img
            src={h.logo_url}
            alt={h.ticker}
            className="w-5 h-5 rounded-full object-cover shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-foreground/[0.08] flex items-center justify-center shrink-0">
            <span className="text-[9px] font-bold text-foreground/40">{h.ticker[0]}</span>
          </div>
        )}
        <span className="text-[13px] font-semibold tracking-wide">{h.ticker}</span>
      </div>

      {/* Shares */}
      <div className="text-[12px] text-foreground/40 tabular-nums w-20 shrink-0">
        {h.shares % 1 === 0 ? h.shares : h.shares.toFixed(2)} shares
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Value/Price */}
      <div className="text-right tabular-nums">
        <div className="text-[13px] font-medium">
          {displayMode === "value" ? fmt(h.value) : fmt(h.currentPrice)}
        </div>
      </div>

      {/* P&L */}
      <div className={`text-right tabular-nums w-24 shrink-0 text-[12px] font-medium ${clr(h.pnl)}`}>
        {displayMode === "value"
          ? fmtSign(h.pnl)
          : `${h.pnlPercent >= 0 ? "+" : ""}${h.pnlPercent.toFixed(1)}%`}
      </div>

      {/* Delete for manual */}
      <div className="w-6 shrink-0">
        {h.source === "manual" && (
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-foreground/30 hover:text-red-400 transition-all p-0.5"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sortable holding row wrapper ──

function SortableHoldingRow(props: {
  holding: EnrichedHolding;
  isSelected: boolean;
  displayMode: DisplayMode;
  onSelect: () => void;
  onDelete: (e: React.MouseEvent) => void;
  fmt: (n: number) => string;
  fmtSign: (n: number) => string;
  clr: (n: number) => string;
  isDragSort: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: props.holding.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      {props.isDragSort && (
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-foreground/15 hover:text-foreground/40 transition-colors shrink-0 mr-1"
          onClick={(e) => e.stopPropagation()}
        >
          ⠿
        </span>
      )}
      <div className="flex-1">
        <HoldingRow {...props} />
      </div>
    </div>
  );
}

// ── Inline rate item (for header bar) ──

function InlineRateItem({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <span
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="text-[11px] text-foreground/25 tabular-nums cursor-grab active:cursor-grabbing hover:text-foreground/40 transition-colors"
    >
      {label}
    </span>
  );
}

// ── Account pane ──

function AccountPane({
  title,
  syncLabel,
  onSync,
  syncing,
  lastSync,
  holdings,
  selectedId,
  onSelectId,
  displayMode,
  fmt,
  fmtSign,
  clr,
  onDelete,
  sensors,
  sortField,
  onDragEnd,
  emptyText,
  accentColor,
  accountValue,
  accountPnl,
  accountPnlPct,
}: {
  title: string;
  syncLabel: string;
  onSync: () => void;
  syncing: boolean;
  lastSync: string | null;
  holdings: EnrichedHolding[];
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  displayMode: DisplayMode;
  fmt: (n: number) => string;
  fmtSign: (n: number) => string;
  clr: (n: number) => string;
  onDelete: (id: string, e: React.MouseEvent) => void;
  sensors: ReturnType<typeof useSensors>;
  sortField: SortField;
  onDragEnd: (event: DragEndEvent) => void;
  emptyText: string;
  accentColor: string;
  accountValue: number;
  accountPnl: number;
  accountPnlPct: number;
}) {
  const selected = holdings.find((h) => h.id === selectedId);

  return (
    <div className="flex flex-col h-full">
      {/* Pane header */}
      <div className="flex items-baseline justify-between mb-5">
        <div className="flex items-baseline gap-3">
          <span className={`inline-block w-2 h-2 rounded-full ${accentColor}`} />
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {lastSync && (
            <span className="text-[11px] text-foreground/30">{formatTimeAgo(lastSync)}</span>
          )}
        </div>
        <button
          onClick={onSync}
          disabled={syncing}
          className="text-[11px] text-foreground/40 hover:text-foreground/70 transition-colors disabled:opacity-30 uppercase tracking-widest font-medium"
        >
          {syncing ? "syncing..." : syncLabel}
        </button>
      </div>

      {/* Account summary */}
      <div className="mb-4">
        <div className="text-[28px] font-bold tracking-tight tabular-nums leading-none">
          {fmt(accountValue)}
        </div>
        <div className={`text-[13px] font-medium mt-1 tabular-nums ${clr(accountPnl)}`}>
          {fmtSign(accountPnl)} ({accountPnlPct >= 0 ? "+" : ""}{accountPnlPct.toFixed(2)}%)
        </div>
      </div>

      {/* Chart */}
      <div className="mb-4">
        {selected ? (
          <div className="h-[280px] bg-foreground/[0.02] rounded-xl p-4">
            <PriceChart
              symbol={selected.ticker}
              avgCost={selected.avg_cost}
              currentPrice={selected.currentPrice}
              pnlPercent={selected.pnlPercent}
              onClose={() => onSelectId(null)}
              fmt={fmt}
            />
          </div>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-[12px] text-foreground/20 rounded-xl border border-dashed border-foreground/[0.06]">
            Select a holding
          </div>
        )}
      </div>

      {/* Holdings list header */}
      <div className="flex items-center gap-3 px-3 pb-2 text-[11px] text-foreground/30 uppercase tracking-wider font-medium">
        <div className="w-20 shrink-0">Ticker</div>
        <div className="w-20 shrink-0">Qty</div>
        <div className="flex-1" />
        <div className="text-right">{displayMode === "value" ? "Value" : "Price"}</div>
        <div className="text-right w-24 shrink-0">P&L</div>
        <div className="w-6 shrink-0" />
      </div>

      {/* Holdings list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {holdings.length === 0 ? (
          <div className="py-12 text-center text-[13px] text-foreground/20">
            {emptyText}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={holdings.map((h) => h.id)} strategy={verticalListSortingStrategy}>
              <div>
                {holdings.map((h) => (
                  <SortableHoldingRow
                    key={h.id}
                    holding={h}
                    isSelected={selectedId === h.id}
                    displayMode={displayMode}
                    onSelect={() => onSelectId(selectedId === h.id ? null : h.id)}
                    onDelete={(e) => onDelete(h.id, e)}
                    fmt={fmt}
                    fmtSign={fmtSign}
                    clr={clr}
                    isDragSort={sortField === "custom"}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
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
  const [selectedTossId, setSelectedTossId] = useState<string | null>(null);
  const [selectedIbkrId, setSelectedIbkrId] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [tossSyncDialogOpen, setTossSyncDialogOpen] = useState(false);
  const [refreshingToss, setRefreshingToss] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ibkrUsername, setIbkrUsername] = useState<string | null>(null);
  const [lastIbkrSync, setLastIbkrSync] = useState<string | null>(null);
  const [lastTossSync, setLastTossSync] = useState<string | null>(null);
  const [tossCredentials, setTossCredentials] = useState<{
    toss_name: string | null;
    toss_birthday: string | null;
    toss_phone: string | null;
  }>({ toss_name: null, toss_birthday: null, toss_phone: null });
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
      setLastTossSync(p.last_toss_sync);
      setTossCredentials({
        toss_name: p.toss_name,
        toss_birthday: p.toss_birthday,
        toss_phone: p.toss_phone,
      });
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

  const loadHoldings = useCallback(async () => {
    try {
      const rawHoldings = await getHoldings();
      if (rawHoldings.length === 0) {
        setHoldings([]);
        setLoading(false);
        return;
      }
      const tickers = rawHoldings.map((h) => h.ticker);
      let quotes: Record<string, Quote> = {};
      try {
        quotes = await getQuotes(tickers);
      } catch {
        // Quotes unavailable (backend down) — show holdings with last known or zero prices
      }
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
      if (Object.keys(quotes).length > 0) setLastRefresh(new Date());
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

  // ── Computed ──

  const totalValue = holdings.reduce((sum, h) => sum + h.value, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.shares * h.avg_cost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const tossHoldings = useMemo(() => holdings.filter((h) => h.source === "toss"), [holdings]);
  const ibkrHoldings = useMemo(() => holdings.filter((h) => h.source !== "toss"), [holdings]);

  const tossValue = tossHoldings.reduce((s, h) => s + h.value, 0);
  const tossCost = tossHoldings.reduce((s, h) => s + h.shares * h.avg_cost, 0);
  const tossPnl = tossValue - tossCost;
  const tossPnlPct = tossCost > 0 ? (tossPnl / tossCost) * 100 : 0;

  const ibkrValue = ibkrHoldings.reduce((s, h) => s + h.value, 0);
  const ibkrCost = ibkrHoldings.reduce((s, h) => s + h.shares * h.avg_cost, 0);
  const ibkrPnl = ibkrValue - ibkrCost;
  const ibkrPnlPct = ibkrCost > 0 ? (ibkrPnl / ibkrCost) * 100 : 0;

  useEffect(() => {
    setHoldingOrder((prev) => {
      const currentIds = new Set(holdings.map((h) => h.id));
      const filtered = prev.filter((id) => currentIds.has(id));
      const newIds = holdings.map((h) => h.id).filter((id) => !new Set(filtered).has(id));
      return [...filtered, ...newIds];
    });
  }, [holdings.map((h) => h.id).join(",")]);

  const sortHoldings = useCallback((list: EnrichedHolding[]) => {
    if (sortField === "custom") {
      const map = new Map(list.map((h) => [h.id, h]));
      return holdingOrder
        .map((id) => map.get(id))
        .filter((h): h is EnrichedHolding => h !== undefined && list.includes(h));
    }
    const sorted = [...list];
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
  }, [sortField, sortDir, holdingOrder]);

  const sortedToss = useMemo(() => sortHoldings(tossHoldings), [tossHoldings, sortHoldings]);
  const sortedIbkr = useMemo(() => sortHoldings(ibkrHoldings), [ibkrHoldings, sortHoldings]);

  const rateRows = useMemo(() => {
    if (!rates) return [];
    const all: Record<string, string> = {
      usd_sgd: `1 USD = ${rates.SGD.toFixed(2)} SGD`,
      usd_krw: `1 USD = ${rates.KRW.toLocaleString("en-US", { maximumFractionDigits: 0 })} KRW`,
      sgd_krw: `1 SGD = ${rates.SGD_KRW.toLocaleString("en-US", { maximumFractionDigits: 0 })} KRW`,
    };
    return rateOrder.map((id) => ({ id, label: all[id] })).filter((r) => r.label);
  }, [rates, rateOrder]);

  // ── Handlers ──

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
      const { holdings: ibkrH } = await getIbkrHoldings();
      await upsertHoldings(
        ibkrH.map((h) => ({ ...h, source: "ibkr" as const })),
        user.id
      );
      const now = new Date().toISOString();
      setLastIbkrSync(now);
      save({ last_ibkr_sync: now });
      await loadHoldings();
    } catch {
      setError("IBKR sync failed. Is the gateway running?");
    } finally {
      setRefreshingIbkr(false);
    }
  };

  const handleSyncToss = async (name: string, birthday: string, phone: string) => {
    setRefreshingToss(true);
    setError(null);
    try {
      const { holdings: tossH } = await syncTossHoldings(name, birthday, phone);
      await upsertHoldings(
        tossH.map((h) => ({ ...h, source: "toss" as const })),
        user.id
      );
      const now = new Date().toISOString();
      setLastTossSync(now);
      save({ last_toss_sync: now });
      await loadHoldings();
    } finally {
      setRefreshingToss(false);
    }
  };

  const handleAddManual = async (ticker: string, shares: number, avgCost: number) => {
    await addManualHolding(user.id, ticker, shares, avgCost);
    await loadHoldings();
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteHolding(id);
    setSelectedTossId((prev) => (prev === id ? null : prev));
    setSelectedIbkrId((prev) => (prev === id ? null : prev));
    await loadHoldings();
  };

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
  const clr = (n: number) => (n >= 0 ? "text-emerald-400" : "text-red-400");

  const CURRENCIES: Currency[] = ["USD", "SGD", "KRW"];
  const SORT_OPTIONS: { field: SortField; label: string }[] = [
    { field: "value", label: "Val" },
    { field: "pnl", label: "P&L" },
    { field: "custom", label: "Custom" },
  ];

  // ════════════════════════════════════════════════════════════════════════
  // ── Render ──
  // ════════════════════════════════════════════════════════════════════════

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* ── Top bar ── */}
      <header className="shrink-0 flex items-center justify-between px-6 h-12 border-b border-foreground/[0.06]">
        <div className="flex items-center gap-6">
          <span className="text-[13px] font-semibold tracking-tight">
            {ibkrUsername ?? user.user_metadata?.full_name ?? user.email ?? "Portfolio"}
          </span>

          {/* Total */}
          <div className="flex items-baseline gap-2">
            <span className="text-[13px] tabular-nums font-medium">{fmt(totalValue)}</span>
            <span className={`text-[11px] tabular-nums font-medium ${clr(totalPnl)}`}>
              {fmtPct(totalPnlPercent)}
            </span>
          </div>

          {/* Live indicator */}
          {lastRefresh && (
            <div className="flex items-center gap-1.5 text-[11px] text-foreground/30">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              <TimeAgo date={lastRefresh} />
            </div>
          )}

          {/* Rates */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleRateDragEnd}>
            <SortableContext items={rateRows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <div className="flex items-center gap-3">
                {rateRows.map((row) => (
                  <InlineRateItem key={row.id} id={row.id} label={row.label} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        <div className="flex items-center gap-1">
          {/* Sort */}
          <div className="flex mr-2">
            {SORT_OPTIONS.map(({ field, label }) => {
              const active = sortField === field;
              return (
                <button
                  key={field}
                  onClick={() => {
                    if (field === "custom") {
                      setSortField("custom");
                      save({ sort_field: "custom" });
                    } else if (active) {
                      const next = sortDir === "desc" ? "asc" : "desc";
                      setSortDir(next);
                      save({ sort_dir: next });
                    } else {
                      setSortField(field);
                      setSortDir("desc");
                      save({ sort_field: field, sort_dir: "desc" });
                    }
                  }}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                    active
                      ? "text-foreground bg-foreground/[0.08]"
                      : "text-foreground/30 hover:text-foreground/50"
                  }`}
                >
                  {label}
                  {active && field !== "custom" && (
                    <span className="ml-0.5">{sortDir === "desc" ? "↓" : "↑"}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Display mode */}
          <div className="flex border-l border-foreground/[0.06] pl-2 mr-2">
            {(["price", "value"] as DisplayMode[]).map((m) => (
              <button
                key={m}
                onClick={() => { setDisplayMode(m); save({ display_mode: m }); }}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors capitalize ${
                  displayMode === m
                    ? "text-foreground bg-foreground/[0.08]"
                    : "text-foreground/30 hover:text-foreground/50"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Currency */}
          <div className="flex border-l border-foreground/[0.06] pl-2 mr-3">
            {CURRENCIES.map((c) => (
              <button
                key={c}
                onClick={() => { setCurrency(c); save({ currency: c }); }}
                className={`px-2 py-1 text-[11px] font-medium rounded transition-colors ${
                  currency === c
                    ? "text-foreground bg-foreground/[0.08]"
                    : "text-foreground/30 hover:text-foreground/50"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Actions */}
          <button
            onClick={() => setAddDialogOpen(true)}
            className="px-2.5 py-1 text-[11px] font-medium text-foreground/50 hover:text-foreground transition-colors"
          >
            + Add
          </button>
          <button
            onClick={() => setInstructionsOpen(true)}
            className="px-2 py-1 text-[11px] text-foreground/30 hover:text-foreground/50 transition-colors"
          >
            ?
          </button>
          <button
            onClick={theme.toggle}
            className="px-2 py-1 text-foreground/30 hover:text-foreground/50 transition-colors"
          >
            {theme.dark ? (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
              </svg>
            ) : (
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          <button
            onClick={onSignOut}
            className="px-2 py-1 text-[11px] text-foreground/30 hover:text-foreground/50 transition-colors"
          >
            out
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="shrink-0 px-6 py-2 bg-red-950/40 text-red-300 text-[12px]">
          {error}
        </div>
      )}

      {/* ── Main: two panes ── */}
      <main className="flex-1 min-h-0 flex">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-[13px] text-foreground/20">
            Loading...
          </div>
        ) : (
          <>
            {/* Toss pane */}
            <div className="flex-1 border-r border-foreground/[0.06] px-6 py-5 flex flex-col min-h-0">
              <AccountPane
                title="Toss Securities"
                syncLabel="sync"
                onSync={() => setTossSyncDialogOpen(true)}
                syncing={refreshingToss}
                lastSync={lastTossSync}
                holdings={sortedToss}
                selectedId={selectedTossId}
                onSelectId={setSelectedTossId}
                displayMode={displayMode}
                fmt={fmt}
                fmtSign={fmtSign}
                clr={clr}
                onDelete={handleDelete}
                sensors={sensors}
                sortField={sortField}
                onDragEnd={handleHoldingDragEnd}
                emptyText="Sync from Toss to see holdings"
                accentColor="bg-blue-400"
                accountValue={tossValue}
                accountPnl={tossPnl}
                accountPnlPct={tossPnlPct}
              />
            </div>

            {/* IBKR pane */}
            <div className="flex-1 px-6 py-5 flex flex-col min-h-0">
              <AccountPane
                title="Interactive Brokers"
                syncLabel="sync"
                onSync={handleRefreshIbkr}
                syncing={refreshingIbkr}
                lastSync={lastIbkrSync}
                holdings={sortedIbkr}
                selectedId={selectedIbkrId}
                onSelectId={setSelectedIbkrId}
                displayMode={displayMode}
                fmt={fmt}
                fmtSign={fmtSign}
                clr={clr}
                onDelete={handleDelete}
                sensors={sensors}
                sortField={sortField}
                onDragEnd={handleHoldingDragEnd}
                emptyText="Sync from IBKR or add manually"
                accentColor="bg-red-400"
                accountValue={ibkrValue}
                accountPnl={ibkrPnl}
                accountPnlPct={ibkrPnlPct}
              />
            </div>
          </>
        )}
      </main>

      {/* Dialogs */}
      <AddHoldingDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAdd={handleAddManual}
      />
      <IbkrInstructionsDialog
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
      />
      <TossSyncDialog
        open={tossSyncDialogOpen}
        onOpenChange={setTossSyncDialogOpen}
        onSync={handleSyncToss}
        savedCredentials={tossCredentials}
        onSaveCredentials={(name, birthday, phone) => {
          setTossCredentials({ toss_name: name, toss_birthday: birthday, toss_phone: phone });
          save({ toss_name: name, toss_birthday: birthday, toss_phone: phone });
        }}
        onClearCredentials={() => {
          setTossCredentials({ toss_name: null, toss_birthday: null, toss_phone: null });
          save({ toss_name: null, toss_birthday: null, toss_phone: null });
        }}
      />
    </div>
  );
}
