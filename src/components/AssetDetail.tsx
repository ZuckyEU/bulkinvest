"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OrderCard } from "@/components/OrderCard";
import { PriceChart } from "@/components/PriceChart";
import { formatPercent, formatSignedUSD, formatUSD } from "@/lib/format";
import { formatQuantity, isCryptoSymbol, matchesSymbol } from "@/lib/symbols";
import type { AccountSummary } from "@/lib/account-types";
import {
  DEFAULT_HISTORY_RANGE,
  HISTORY_RANGES,
  RANGE_DESCRIPTIONS,
  type HistoryRange,
  type PriceHistory,
} from "@/lib/market-types";

type LoadState = "idle" | "loading" | "ready" | "error";

/** The stake-metrics slice of /api/portfolio/holdings this page needs. */
type PositionSummary = {
  symbol: string;
  name: string | null;
  shares: number;
  avgPrice: number;
  currentPrice: number | null;
  marketValue: number;
  unrealizedPl: number | null;
  unrealizedPlPercent: number | null;
};

/**
 * A single asset: price chart plus the order ticket.
 *
 * Pre-selected variant of the Markets explorer, reached by clicking a holdings
 * row. When the user already holds the asset the ticket leads with a
 * "Close position" action, so a position can be exited without hunting for the
 * sell tab.
 */
export function AssetDetail({ symbol }: { symbol: string }) {
  const [range, setRange] = useState<HistoryRange>(DEFAULT_HISTORY_RANGE);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

  const [position, setPosition] = useState<PositionSummary | null>(null);
  const [closeSignal, setCloseSignal] = useState(0);
  const ticketRef = useRef<HTMLDivElement>(null);

  const loadAccount = useCallback(async () => {
    try {
      const response = await fetch("/api/account", { cache: "no-store" });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error ?? "Could not load the account.");
      }

      setAccount(body as AccountSummary);
      setAccountError(null);
    } catch (caught) {
      setAccountError(
        caught instanceof Error ? caught.message : "Could not load the account.",
      );
    }
  }, []);

  useEffect(() => {
    void loadAccount();
  }, [loadAccount]);

  // The holdings endpoint carries the stake metrics (entry price, live price,
  // value on stake, unrealised P/L) that /api/account omits.
  const loadPosition = useCallback(async () => {
    try {
      const response = await fetch("/api/portfolio/holdings", { cache: "no-store" });
      if (!response.ok) return;

      const body = await response.json();
      const rows: PositionSummary[] = Array.isArray(body?.positions) ? body.positions : [];
      setPosition(rows.find((row) => matchesSymbol(row.symbol, symbol)) ?? null);
    } catch {
      // The summary card is an enhancement; a failure must not break the page.
      setPosition(null);
    }
  }, [symbol]);

  useEffect(() => {
    void loadPosition();
  }, [loadPosition]);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    setError(null);

    (async () => {
      try {
        const response = await fetch(
          `/api/stocks/${encodeURIComponent(symbol)}/history?range=${range}`,
          { signal: controller.signal },
        );
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body?.error ?? "Failed to load price history.");
        }

        setHistory(body as PriceHistory);
        setState("ready");
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(
          caught instanceof Error ? caught.message : "Failed to load price history.",
        );
        setState("error");
      }
    })();

    return () => controller.abort();
  }, [symbol, range, reloadToken]);

  // The holding for this asset, if any, drives the close-position CTA.
  const held = useMemo(
    () => account?.holdings.find((holding) => matchesSymbol(holding.symbol, symbol)),
    [account, symbol],
  );
  const chartPrice = state === "ready" && history ? history.latestPrice : null;

  // Prefer the holdings endpoint (it carries every stake metric); fall back to
  // /api/account so close-position still works if only that call succeeds.
  const heldShares = position?.shares ?? held?.shares ?? 0;
  const hasPosition = heldShares > 0;
  const assetName = position?.name?.trim() || held?.name?.trim() || symbol;

  // Value on stake: shares x live price, falling back to the entry price when the
  // broker has no quote yet, so the card never reads $0.00 for a real holding.
  const avgPrice = position?.avgPrice ?? held?.avgPrice ?? 0;
  const unitPrice = position?.currentPrice ?? chartPrice ?? avgPrice;
  const stakeValue =
    position && position.marketValue > 0
      ? position.marketValue
      : heldShares * unitPrice;
  const costBasis = heldShares * avgPrice;
  const unrealizedPl = position?.unrealizedPl ?? stakeValue - costBasis;
  const unrealizedPlPercent =
    position?.unrealizedPlPercent ??
    (costBasis !== 0 ? (unrealizedPl / Math.abs(costBasis)) * 100 : null);
  const profitable = unrealizedPl >= 0;

  const positive = (history?.rangeChange ?? 0) >= 0;
  const isCrypto = isCryptoSymbol(symbol);

  /** Pre-fill a full-position sell in the ticket and bring it into view. */
  function closePosition() {
    setCloseSignal((signal) => signal + 1);
    ticketRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <a
          href="/markets"
          className="text-xs text-slate-400 transition-colors hover:text-white"
        >
          ← Back to markets
        </a>
      </div>

      {/* Position summary: only rendered when the user actually holds this. */}
      {hasPosition ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Your position
              </p>
              <h2 className="mt-2 text-lg font-medium text-white">
                You currently hold{" "}
                <span className="font-mono text-emerald-300">
                  {formatQuantity(heldShares)}
                </span>{" "}
                {isCrypto ? assetName : "shares"} worth{" "}
                <span className="text-emerald-300">{formatUSD(stakeValue)}</span> in{" "}
                this asset.
              </h2>
              <p className="mt-1 text-sm text-slate-400">{assetName}</p>
            </div>

            <button
              type="button"
              onClick={closePosition}
              className="rounded-xl border border-rose-400/30 bg-rose-400/[0.08] px-5 py-3 text-left transition-colors hover:bg-rose-400/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
            >
              <span className="block text-sm font-semibold text-rose-300">
                Close Position (Sell All)
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">
                Liquidate {formatQuantity(heldShares)} {symbol}
              </span>
            </button>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/5 pt-5 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-slate-500">Shares / Units Held</dt>
              <dd className="mt-1 font-mono text-sm font-medium text-slate-200">
                {formatQuantity(heldShares)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Avg Entry Price</dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">
                {formatUSD(avgPrice)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Current Price</dt>
              <dd className="mt-1 text-sm font-medium text-slate-200">
                {formatUSD(unitPrice)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Unrealized Gain/Loss</dt>
              <dd
                className={`mt-1 text-sm font-medium ${
                  profitable ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {formatSignedUSD(unrealizedPl)}
                {unrealizedPlPercent !== null ? (
                  <span className="ml-1.5 text-xs text-slate-500">
                    {formatPercent(unrealizedPlPercent, true)}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Chart */}
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="font-mono text-2xl font-semibold text-white">
                  {symbol}
                </h2>
                {history && state === "ready" ? (
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                      positive
                        ? "bg-emerald-400/10 text-emerald-400"
                        : "bg-rose-400/10 text-rose-400"
                    }`}
                  >
                    {formatPercent(history.rangeChangePercent, true)}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {isCrypto ? "Crypto pair" : "Equity ticker"}
              </p>
            </div>

            {history && state === "ready" ? (
              <div className="text-right">
                <p className="text-3xl font-semibold tracking-tight text-white">
                  {formatUSD(history.latestPrice)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {RANGE_DESCRIPTIONS[history.range]}
                  {" · "}
                  <span className={positive ? "text-emerald-400" : "text-rose-400"}>
                    {positive ? "+" : "-"}
                    {formatUSD(Math.abs(history.rangeChange))}
                  </span>
                </p>
              </div>
            ) : null}
          </div>

          {/* Range selector */}
          <div className="mt-6 flex flex-wrap gap-1.5">
            {HISTORY_RANGES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                aria-pressed={range === option}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  range === option
                    ? "bg-white/10 text-white"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <div className="mt-6">
            {state === "loading" ? (
              <div className="grid h-80 place-items-center">
                <span
                  className="h-6 w-6 animate-spin rounded-full border-2 border-slate-600 border-t-transparent"
                  aria-hidden="true"
                />
                <span className="sr-only">Loading price history</span>
              </div>
            ) : null}

            {state === "error" ? (
              <div className="grid h-80 place-items-center rounded-xl border border-rose-400/20 bg-rose-400/[0.04]">
                <div className="max-w-sm text-center">
                  <p className="text-sm font-medium text-rose-300">
                    Could not load price history
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{error}</p>
                  <button
                    type="button"
                    onClick={() => setReloadToken((token) => token + 1)}
                    className="mt-4 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : null}

            {state === "ready" && history ? (
              <PriceChart
                points={history.points}
                interval={history.interval}
                positive={positive}
              />
            ) : null}
          </div>

          {state === "ready" && history ? (
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/5 pt-5 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-slate-500">Range change</dt>
                <dd
                  className={`mt-1 text-sm font-medium ${
                    positive ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {positive ? "+" : "-"}
                  {formatUSD(Math.abs(history.rangeChange))}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">52-week high</dt>
                <dd className="mt-1 text-sm font-medium text-slate-200">
                  {history.fiftyTwoWeekHigh !== null
                    ? formatUSD(history.fiftyTwoWeekHigh)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">52-week low</dt>
                <dd className="mt-1 text-sm font-medium text-slate-200">
                  {history.fiftyTwoWeekLow !== null
                    ? formatUSD(history.fiftyTwoWeekLow)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Data points</dt>
                <dd className="mt-1 text-sm font-medium text-slate-200">
                  {history.points.length}
                </dd>
              </div>
            </dl>
          ) : null}
        </section>

        {/* Order entry, led by the close-position action when held. */}
        <div ref={ticketRef}>
          <OrderCard
            symbol={symbol}
            name={assetName}
            price={chartPrice}
            account={account}
            accountError={accountError}
            onTraded={() => {
              void loadAccount();
              void loadPosition();
            }}
            initialSide={hasPosition ? "SELL" : "BUY"}
            closeSignal={closeSignal}
          />
        </div>
      </div>
    </div>
  );
}