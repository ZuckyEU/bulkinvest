"use client";

import { useCallback, useEffect, useState } from "react";
import { FeaturedAssets } from "@/components/FeaturedAssets";
import { OrderCard } from "@/components/OrderCard";
import { PriceChart } from "@/components/PriceChart";
import { StockSearch, type StockSearchOption } from "@/components/StockSearch";
import { formatPercent, formatUSD } from "@/lib/format";
import type { AccountSummary } from "@/lib/account-types";
import type { FeaturedQuote } from "@/lib/featured-assets";
import {
  DEFAULT_HISTORY_RANGE,
  HISTORY_RANGES,
  RANGE_DESCRIPTIONS,
  type HistoryRange,
  type PriceHistory,
} from "@/lib/market-types";

const QUICK_PICKS: StockSearchOption[] = [
  { symbol: "AAPL", name: "Apple Inc.", type: "Common Stock" },
  { symbol: "NVDA", name: "NVIDIA Corp.", type: "Common Stock" },
  { symbol: "MSFT", name: "Microsoft Corp.", type: "Common Stock" },
  { symbol: "TSLA", name: "Tesla Inc.", type: "Common Stock" },
];

type LoadState = "idle" | "loading" | "ready" | "error";

type StockExplorerProps = {
  /** Server-rendered featured pricing, so the grid paints on first load. */
  initialFeatured?: FeaturedQuote[];
};

export function StockExplorer({ initialFeatured }: StockExplorerProps) {
  const [selected, setSelected] = useState<StockSearchOption | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [range, setRange] = useState<HistoryRange>(DEFAULT_HISTORY_RANGE);
  const [history, setHistory] = useState<PriceHistory | null>(null);
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!selected) return;

    const controller = new AbortController();
    setState("loading");
    setError(null);

    (async () => {
      try {
        const response = await fetch(
          `/api/stocks/${encodeURIComponent(selected.symbol)}/history?range=${range}`,
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
  }, [selected, range, reloadToken]);

  const positive = (history?.rangeChange ?? 0) >= 0;
  const livePrice =
    state === "ready" && history ? history.latestPrice : null;

  return (
    <div className="space-y-6">
      <div>
        <StockSearch onSelect={setSelected} onQueryChange={setSearchQuery} />

        {!selected ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Try:</span>
            {QUICK_PICKS.map((pick) => (
              <button
                key={pick.symbol}
                type="button"
                onClick={() => setSelected(pick)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs font-medium text-slate-300 transition-colors hover:border-emerald-400/30 hover:text-white"
              >
                {pick.symbol}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/*
        The featured grid is the resting state of this page, but it stands down
        whenever the user is searching or has already opened an asset.
      */}
      {!selected ? (
        <FeaturedAssets
          initialAssets={initialFeatured}
          visible={searchQuery === ""}
        />
      ) : null}

      {selected ? (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {/* Chart */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="font-mono text-2xl font-semibold text-white">
                    {selected.symbol}
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
                <p className="mt-1 text-sm text-slate-400">{selected.name}</p>
              </div>

              {history && state === "ready" ? (
                <div className="text-right">
                  <p className="text-3xl font-semibold tracking-tight text-white">
                    {formatUSD(history.latestPrice)}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {RANGE_DESCRIPTIONS[history.range]}
                    {" · "}
                    <span
                      className={positive ? "text-emerald-400" : "text-rose-400"}
                    >
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

            {/* Chart / states */}
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

            {/* Range stats */}
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

          {/* Order entry */}
          <OrderCard
            symbol={selected.symbol}
            name={selected.name}
            price={livePrice}
            account={account}
            accountError={accountError}
            onTraded={loadAccount}
          />
        </div>
      ) : null}
    </div>
  );
}
