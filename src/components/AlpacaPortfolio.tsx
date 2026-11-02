"use client";

import { useCallback, useEffect, useState } from "react";
import { AllocationChart } from "@/components/AllocationChart";
import { HoldingsTable } from "@/components/HoldingsTable";
import { formatPercent, formatSignedUSD, formatUSD } from "@/lib/format";
import type { LiveHolding } from "@/lib/live";
import type { PortfolioSnapshot } from "@/lib/portfolio-types";

const REFRESH_MS = 30_000;

type AlpacaPortfolioProps = {
  initialSnapshot: PortfolioSnapshot;
  /** The user's own ledger balance (deposits), kept separate from the broker. */
  localCash: number;
  refreshMs?: number;
};

/** Map a broker position onto the shape the holdings table expects. */
function toLiveHolding(
  position: PortfolioSnapshot["positions"][number],
  positionsValue: number,
): LiveHolding {
  const currentPrice = position.currentPrice ?? position.avgEntryPrice ?? 0;
  const marketValue = position.marketValue ?? position.qty * currentPrice;
  const costBasis = position.costBasis ?? 0;

  return {
    symbol: position.symbol,
    name: position.name,
    shares: position.qty,
    avgPrice: position.avgEntryPrice ?? 0,
    currentPrice,
    hasLiveQuote: position.currentPrice !== null,
    costBasis,
    marketValue,
    unrealizedPnl: position.unrealizedPl ?? 0,
    unrealizedPnlPercent: position.unrealizedPlPercent ?? 0,
    weight: positionsValue > 0 ? (marketValue / positionsValue) * 100 : 0,
    dailyChange: position.dailyChange,
    dailyChangePercent: position.dailyChangePercent,
  };
}

function Metric({
  label,
  value,
  sub,
  valueClassName = "text-white",
}: {
  label: string;
  value: string;
  sub: string;
  valueClassName?: string;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
        {label}
      </p>
      <p className={`mt-4 text-3xl font-semibold tracking-tight ${valueClassName}`}>
        {value}
      </p>
      <p className="mt-2 text-sm text-slate-400">{sub}</p>
    </section>
  );
}

/**
 * Portfolio view backed directly by Alpaca.
 *
 * Polls /api/portfolio so cash, buying power and positions stay in sync with
 * the broker instead of a local mirror.
 */
export function AlpacaPortfolio({
  initialSnapshot,
  localCash,
  refreshMs = REFRESH_MS,
}: AlpacaPortfolioProps) {
  const [snapshot, setSnapshot] = useState<PortfolioSnapshot>(initialSnapshot);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/portfolio", { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not refresh the portfolio.");
      }
      setSnapshot(body as PortfolioSnapshot);
      setUpdatedAt(new Date());
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not refresh the portfolio.",
      );
    } finally {
      setRefreshing(false);
    }
  }, []);

  // Background refresh: positions and market values update in place every
  // `refreshMs` (no navigation, no full page reload).
  useEffect(() => {
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      await load();
    }

    const timer = window.setInterval(tick, refreshMs);

    // Returning to a backgrounded tab should not wait out the interval.
    function onVisibility() {
      if (!document.hidden) void load();
    }
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, refreshMs]);

  const { account, positions, totals } = snapshot;

  const equity = account.equity ?? 0;
  const cash = account.cash ?? 0;
  const buyingPower = account.buyingPower ?? cash;
  const positionsValue = totals.positionsValue;
  const unrealized = totals.unrealizedPl;
  const daily = totals.dailyChange;

  const unrealizedPositive = unrealized >= 0;
  const investedPercent = equity > 0 ? (positionsValue / equity) * 100 : 0;

  const holdings: LiveHolding[] = positions.map((position) =>
    toLiveHolding(position, positionsValue),
  );

  // Split open positions for the allocation chart.
  const isCryptoClass = (assetClass: string | null) =>
    assetClass === "crypto" || assetClass === "crypto_perp";
  const cryptoValue = positions
    .filter((position) => isCryptoClass(position.assetClass))
    .reduce((sum, position) => sum + (position.marketValue ?? 0), 0);
  const equitiesValue = positions
    .filter((position) => !isCryptoClass(position.assetClass))
    .reduce((sum, position) => sum + (position.marketValue ?? 0), 0);

  const blocked = account.tradingBlocked || account.accountBlocked;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3 text-xs text-slate-500">
        <span
          className={`rounded-full px-2 py-0.5 font-semibold ${
            snapshot.paper
              ? "bg-sky-400/10 text-sky-400"
              : "bg-rose-400/10 text-rose-300"
          }`}
        >
          {snapshot.paper ? "Paper trading" : "Live trading"}
        </span>
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
          {error ? "Update failed" : refreshing ? "Refreshing…" : "Up to date"}
        </span>
        <span aria-live="polite">
          {updatedAt
            ? `Updated ${updatedAt.toLocaleTimeString()} · every ${Math.round(refreshMs / 1000)}s`
            : `Auto-refreshing every ${Math.round(refreshMs / 1000)}s`}
        </span>
        <button
          type="button"
          onClick={() => void load()}
          disabled={refreshing}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 font-medium text-slate-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
          {error} Showing the last known values.
        </p>
      ) : null}

      {blocked ? (
        <p className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-300">
          Your trading account is {account.accountBlocked ? "blocked" : "restricted"} —
          orders will be rejected until it is resolved.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Deposit Balance"
          value={formatUSD(localCash)}
          sub="Cash you've deposited (your in-app balance)"
        />

        <Metric
          label="Trading Portfolio"
          value={formatUSD(equity)}
          sub={
            positions.length === 0
              ? "No open positions"
              : `${positions.length} open ${
                  positions.length === 1 ? "position" : "positions"
                }`
          }
        />

        <Metric
          label="Available Buying Power"
          value={formatUSD(buyingPower)}
          sub="Ready to invest right now"
        />

        <Metric
          label="Unrealized P&L"
          value={formatSignedUSD(unrealized)}
          valueClassName={unrealizedPositive ? "text-emerald-400" : "text-rose-400"}
          sub={`Today ${formatSignedUSD(daily)} · ${formatPercent(
            equity > 0 ? (unrealized / equity) * 100 : 0,
            true,
          )}`}
        />
      </div>

      <p className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-slate-500">
        <span className="font-medium text-slate-400">Deposit balance</span> is the cash
        you have added to this app. It is tracked separately from the trading account
        used to fill orders.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <AllocationChart
          cash={cash}
          equities={equitiesValue}
          crypto={cryptoValue}
        />
        <HoldingsTable
          holdings={holdings}
          holdingsValue={positionsValue}
          className="lg:col-span-2"
        />
      </div>

      {snapshot.pendingOrders.length > 0 ? (
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03]">
          <div className="flex items-center justify-between px-6 py-5">
            <h2 className="text-lg font-semibold text-white">Pending orders</h2>
            <span className="text-xs text-slate-500">
              Working at the broker · not yet filled
            </span>
          </div>
          <ul className="divide-y divide-white/5 border-t border-white/5 px-6">
            {snapshot.pendingOrders.map((order) => {
              const isBuy = order.side === "buy";
              const price = order.limitPrice ?? order.referencePrice;
              return (
                <li
                  key={order.id}
                  className="flex flex-wrap items-center justify-between gap-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-semibold ${
                        isBuy
                          ? "bg-sky-400/10 text-sky-400"
                          : "bg-violet-400/10 text-violet-300"
                      }`}
                    >
                      {order.side.toUpperCase()}
                    </span>
                    <div>
                      <p className="text-sm font-medium text-white">{order.symbol}</p>
                      <p className="text-xs text-slate-500">
                        {order.qty > 0 ? `${order.qty} units` : "market amount"}
                        {price !== null ? ` · limit ${formatUSD(price)}` : ""}
                        {" · "}
                        {order.type}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-medium text-amber-300">
                      {order.type === "limit" && order.qty > 0
                        ? "Queued for market open"
                        : order.status}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(order.submittedAt).toLocaleString()}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className="mt-4 text-center text-xs text-slate-600">
        Positions and market values refresh automatically every{" "}
        {Math.round(refreshMs / 1000)} seconds.
        {investedPercent > 0
          ? ` ${formatPercent(investedPercent)} of the portfolio is invested.`
          : ""}
      </p>
    </>
  );
}
