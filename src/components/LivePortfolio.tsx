"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DeltaBadge } from "@/components/DeltaBadge";
import { HoldingsTable } from "@/components/HoldingsTable";
import type { AccountSummary } from "@/lib/account-types";
import { formatPercent, formatSignedUSD, formatUSD } from "@/lib/format";
import { buildLivePortfolio, type QuoteMap } from "@/lib/live";

const REFRESH_MS = 30_000;

type LivePortfolioProps = {
  account: AccountSummary;
  deposits: number;
  /** Prices rendered on the server, so the first paint needs no request. */
  initialQuotes: QuoteMap;
  refreshMs?: number;
};

function TrendChip({ label, positive }: { label: string; positive: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
        positive
          ? "bg-emerald-400/10 text-emerald-400"
          : "bg-rose-400/10 text-rose-400"
      }`}
    >
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" aria-hidden="true">
        <path
          d={positive ? "M2.5 8.5 5 6l2 1.5 2.5-4" : "M2.5 3.5 5 6l2-1.5 2.5 4"}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {label}
    </span>
  );
}

type MetricCardProps = {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
  chip?: ReactNode;
  footer?: ReactNode;
};

function MetricCard({
  label,
  value,
  sub,
  valueClassName = "text-white",
  chip,
  footer,
}: MetricCardProps) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
          {label}
        </p>
        {chip}
      </div>
      <p className={`mt-4 text-3xl font-semibold tracking-tight ${valueClassName}`}>
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-400">{sub}</p>
      {footer}
    </section>
  );
}

/**
 * Dashboard portfolio with background price updates.
 *
 * Prices refresh every 30 seconds (and immediately when the tab regains
 * focus). Only the holdings being held are requested, and the totals are
 * recomputed in the browser with the same pure maths the server uses.
 */
export function LivePortfolio({
  account,
  deposits,
  initialQuotes,
  refreshMs = REFRESH_MS,
}: LivePortfolioProps) {
  const [quotes, setQuotes] = useState<QuoteMap>(initialQuotes);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const symbols = useMemo(
    () => account.holdings.map((holding) => holding.symbol),
    [account.holdings],
  );
  const symbolsKey = symbols.join(",");

  // Adopt fresh server prices after a router.refresh() (e.g. post-deposit).
  const initialKey = useMemo(() => JSON.stringify(initialQuotes), [initialQuotes]);
  useEffect(() => {
    setQuotes(initialQuotes);
  }, [initialKey, initialQuotes]);

  useEffect(() => {
    if (symbolsKey === "") return;

    let cancelled = false;

    async function load() {
      setRefreshing(true);
      try {
        const response = await fetch(
          `/api/stocks/quotes?symbols=${encodeURIComponent(symbolsKey)}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(body?.error ?? "Could not refresh prices.");
        }

        if (cancelled) return;

        setQuotes((previous) => {
          const next: QuoteMap = { ...previous };
          for (const quote of body?.quotes ?? []) {
            next[quote.symbol] = {
              price: quote.price,
              change: typeof quote.change === "number" ? quote.change : null,
              changePercent:
                typeof quote.changePercent === "number" ? quote.changePercent : null,
            };
          }
          return next;
        });
        setUpdatedAt(new Date());
        setError(null);
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not refresh prices.");
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    const timer = window.setInterval(load, refreshMs);

    // Coming back to a backgrounded tab should not wait out the interval.
    function onVisibility() {
      if (!document.hidden) void load();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [symbolsKey, refreshMs]);

  const portfolio = buildLivePortfolio(account, quotes, deposits);

  const pnlPositive = portfolio.pnl >= 0;
  const dayPositive = portfolio.dailyChange >= 0;
  const positionCount = portfolio.holdings.length;
  const unpriced = portfolio.holdings.filter((holding) => !holding.hasLiveQuote);
  const investedPercent =
    portfolio.totalValue > 0
      ? (portfolio.holdingsValue / portfolio.totalValue) * 100
      : 0;
  const cashPercent =
    portfolio.totalValue > 0
      ? (portfolio.cashBalance / portfolio.totalValue) * 100
      : 0;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              error
                ? "bg-rose-400"
                : refreshing
                  ? "animate-pulse bg-amber-400"
                  : "bg-emerald-400"
            }`}
            aria-hidden="true"
          />
          {error
            ? "Live prices unavailable"
            : refreshing
              ? "Updating prices…"
              : "Live prices"}
        </span>
        <span aria-live="polite">
          {positionCount === 0
            ? "No positions to price"
            : updatedAt
              ? `Updated ${updatedAt.toLocaleTimeString()} · every ${Math.round(
                  refreshMs / 1000,
                )}s`
              : `Auto-updating every ${Math.round(refreshMs / 1000)}s`}
        </span>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
          {error} Prices shown are the last known values.
        </p>
      ) : null}

      {/* Top metric cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Portfolio Value"
          value={formatUSD(portfolio.totalValue)}
          sub={
            positionCount === 0
              ? "All cash, no open positions"
              : `Cash plus ${positionCount} open ${
                  positionCount === 1 ? "position" : "positions"
                }`
          }
          chip={
            <TrendChip
              label={formatPercent(portfolio.pnlPercent, true)}
              positive={pnlPositive}
            />
          }
          footer={
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Invested</span>
                <span>{formatPercent(investedPercent)} of portfolio</span>
              </div>
              <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full bg-gradient-to-r from-emerald-400 to-sky-500"
                  style={{ width: `${investedPercent}%` }}
                />
              </div>
              <div className="mt-3 flex justify-between text-xs text-slate-500">
                <span>{formatUSD(portfolio.holdingsValue)} invested</span>
                <span>{formatUSD(portfolio.cashBalance)} cash</span>
              </div>
            </div>
          }
        />

        <MetricCard
          label="Today"
          value={formatSignedUSD(portfolio.dailyChange)}
          valueClassName={dayPositive ? "text-emerald-400" : "text-rose-400"}
          sub={
            portfolio.hasDailyChange
              ? "Change in open positions since previous close"
              : "Waiting for daily price data"
          }
          chip={
            portfolio.hasDailyChange ? (
              <DeltaBadge change={null} changePercent={portfolio.dailyChangePercent} />
            ) : undefined
          }
          footer={
            <div className="mt-6 text-xs text-slate-500">
              {positionCount === 0
                ? "Add a position to track daily moves."
                : "Your long positions, priced live."}
            </div>
          }
        />

        <MetricCard
          label="Available Buying Power"
          value={formatUSD(portfolio.cashBalance)}
          sub="Settled cash ready to trade"
          footer={
            <div className="mt-6">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Cash</span>
                <span>{formatPercent(cashPercent)} of portfolio</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-500"
                  style={{ width: `${cashPercent}%` }}
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {formatUSD(portfolio.holdingsValue)} currently invested
              </p>
            </div>
          }
        />

        <MetricCard
          label="Net Profit / Loss"
          value={formatSignedUSD(portfolio.pnl)}
          valueClassName={pnlPositive ? "text-emerald-400" : "text-rose-400"}
          sub={
            portfolio.deposits === 0
              ? "No deposits yet"
              : `Against ${formatUSD(portfolio.deposits)} deposited`
          }
          chip={
            <TrendChip
              label={formatPercent(portfolio.pnlPercent, true)}
              positive={pnlPositive}
            />
          }
          footer={
            <div className="mt-6 grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                <p className="text-slate-500">Unrealized</p>
                <p
                  className={`mt-1 font-medium ${
                    portfolio.unrealizedPnl >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {formatSignedUSD(portfolio.unrealizedPnl)}
                </p>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                <p className="text-slate-500">Realized</p>
                <p
                  className={`mt-1 font-medium ${
                    portfolio.realizedPnl >= 0
                      ? "text-emerald-400"
                      : "text-rose-400"
                  }`}
                >
                  {formatSignedUSD(portfolio.realizedPnl)}
                </p>
              </div>
            </div>
          }
        />
      </div>

      <div className="mt-8">
        <HoldingsTable
          holdings={portfolio.holdings}
          holdingsValue={portfolio.holdingsValue}
        />
      </div>

      {unpriced.length > 0 ? (
        <p className="mt-8 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-center text-xs text-amber-300">
          Live quotes were unavailable for{" "}
          {unpriced.map((holding) => holding.symbol).join(", ")}. Those rows are
          valued at average cost, so unrealized P/L reads as zero.
        </p>
      ) : null}
    </>
  );
}
