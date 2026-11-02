"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MarketCatalog } from "@/components/MarketCatalog";
import { formatPercent, formatSignedUSD, formatUSD } from "@/lib/format";
import { toAssetSlug } from "@/lib/symbols";
import type {
  FeaturedCategory,
  FeaturedQuote,
} from "@/lib/featured-assets";

/**
 * Trending & Popular assets shown on the Markets landing page.
 *
 * Replaces the previous "search for a ticker" placeholder so the page is useful
 * on arrival. Two tabs mirror the two pricing sources: equities from the quote
 * provider, crypto from Alpaca.
 *
 * Cards link to /markets/[ticker], where the chart and trade ticket live.
 */

const REFRESH_MS = 30_000;

const TABS: { id: FeaturedCategory; label: string }[] = [
  { id: "equities", label: "Popular Equities" },
  { id: "crypto", label: "Featured Crypto" },
];

type FeaturedAssetsProps = {
  /** Server-rendered pricing, so the grid is populated on first paint. */
  initialAssets?: FeaturedQuote[];
  /**
   * False while the user is typing in the search box.
   *
   * The grid is hidden then (the autocomplete dropdown takes over), and polling
   * is suspended so we do not fetch prices nobody can see.
   */
  visible: boolean;
};

export function FeaturedAssets({ initialAssets, visible }: FeaturedAssetsProps) {
  const [tab, setTab] = useState<FeaturedCategory>("equities");
  const [showAll, setShowAll] = useState(false);
  const [assets, setAssets] = useState<FeaturedQuote[]>(initialAssets ?? []);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/markets/featured", { cache: "no-store" });
      if (!response.ok) return;

      const body = await response.json();
      if (Array.isArray(body?.assets)) {
        setAssets(body.assets as FeaturedQuote[]);
        setFailed(false);
      }
    } catch {
      // Keep whatever the server already rendered rather than blanking the grid.
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on an interval, but only while the grid is actually on screen.
  useEffect(() => {
    if (!visible) return;

    // Prices may be stale from the server render; sync once on show.
    setLoading(true);
    void load();

    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, load]);

  if (!visible) return null;

  const shown = assets.filter((asset) => asset.category === tab);
  const priced = assets.filter((asset) => asset.price !== null).length;

  return (
    <>
      <section aria-labelledby="featured-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2
            id="featured-heading"
            className="text-sm font-semibold uppercase tracking-widest text-slate-400"
          >
            Trending &amp; Popular
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            {loading
              ? "Refreshing live prices…"
              : priced > 0
                ? `Live prices · ${priced} of ${assets.length} assets quoted`
                : "Live prices unavailable right now"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            role="tablist"
            aria-label="Featured asset categories"
            className="flex flex-wrap gap-1.5"
          >
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => setTab(entry.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                  tab === entry.id
                    ? "bg-white/10 text-white"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                }`}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {/* Reveals the full tradable catalog behind the curated grid. */}
          <button
            type="button"
            aria-expanded={showAll}
            aria-controls="catalog-region"
            onClick={() => setShowAll((previous) => !previous)}
            className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3.5 py-2 text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-400/50 hover:bg-emerald-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {showAll ? "Hide All Markets" : "View All Markets"}
          </button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="mt-5 grid h-40 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
          <div className="text-center">
            {loading ? (
              <>
                <span
                  className="mx-auto block h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-transparent"
                  aria-hidden="true"
                />
                <span className="sr-only">Loading featured assets</span>
              </>
            ) : (
              <p className="text-sm text-slate-500">
                {failed
                  ? "Could not load featured prices"
                  : "No featured assets available"}
              </p>
            )}
          </div>
        </div>
      ) : (
        <ul
          role="tabpanel"
          className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        >
          {shown.map((asset) => (
            <FeaturedCard key={asset.symbol} asset={asset} />
          ))}
        </ul>
      )}
      </section>

      {/*
        Always rendered so the toggle's `aria-controls` target exists even while
        the catalog is collapsed.
      */}
      <div id="catalog-region">
        <MarketCatalog expanded={showAll} />
      </div>
    </>
  );
}

function FeaturedCard({ asset }: { asset: FeaturedQuote }) {
  const changePercent = asset.changePercent;
  const positive = (changePercent ?? 0) >= 0;
  const hasChange = changePercent !== null;

  return (
    <li className="group relative rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {/*
            The stretched pseudo-element makes the whole card the hit area while
            keeping a single, correctly-labelled link for keyboard users.
          */}
          <Link
            href={`/markets/${toAssetSlug(asset.symbol)}`}
            aria-label={`Trade ${asset.name} (${asset.symbol})`}
            className="relative grid h-10 shrink-0 place-items-center rounded-lg bg-white/5 px-3 font-mono text-xs font-semibold text-slate-200 transition-colors group-hover:bg-emerald-400/10 group-hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 after:absolute after:inset-0 after:content-['']"
          >
            {asset.symbol}
          </Link>
          <p className="min-w-0 truncate text-sm text-slate-400">{asset.name}</p>
        </div>

        {hasChange ? (
          <span
            className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${
              positive ? "bg-emerald-400/10 text-emerald-400" : "bg-rose-400/10 text-rose-400"
            }`}
          >
            {formatPercent(changePercent, true)}
          </span>
        ) : null}
      </div>

      <p className="mt-4 text-2xl font-semibold tracking-tight text-white">
        {asset.price !== null ? formatUSD(asset.price) : "—"}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        {hasChange && asset.change !== null ? (
          <>
            <span className={positive ? "text-emerald-400" : "text-rose-400"}>
              {formatSignedUSD(asset.change)}
            </span>{" "}
            · {asset.category === "crypto" ? "past 24h" : "today"}
          </>
        ) : (
          "Price unavailable"
        )}
      </p>

      <Link
        href={`/markets/${toAssetSlug(asset.symbol)}`}
        className="relative mt-4 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:border-emerald-400/30 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        Trade
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </li>
  );
}