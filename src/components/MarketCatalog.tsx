"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CatalogItem, CatalogPage } from "@/lib/market-catalog";

/**
 * "Explore All Markets" — the browsable asset catalog behind the View All button.
 *
 * The curated Trending grid only shows a handful of names, so this reveals the
 * full tradable universe (thousands of instruments) with Load More paging and a
 * search box that filters the whole catalog server-side.
 *
 * Rows are metadata only — pricing thousands of symbols is not viable, and the
 * asset detail page already carries the live quote and chart. Each row links
 * straight there.
 */

const DEBOUNCE_MS = 250;

export type MarketCatalogProps = {
  /** False until the user opens it; paging only starts when it is open. */
  expanded: boolean;
};

type LoadState = "idle" | "loading" | "error";

export function MarketCatalog({ expanded }: MarketCatalogProps) {
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<LoadState>("idle");

  // Guards against an older, slower response overwriting a newer one.
  const requestRef = useRef(0);

  const fetchPage = useCallback(
    async (targetPage: number, term: string, mode: "replace" | "append") => {
      const requestId = ++requestRef.current;
      setState("loading");

      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          limit: "12",
        });
        if (term !== "") params.set("q", term);

        const response = await fetch(`/api/markets/list?${params}`, {
          cache: "no-store",
        });
        const body = await response.json();

        if (requestId !== requestRef.current) return;

        if (!response.ok) {
          setState("error");
          return;
        }

        const result = body as CatalogPage;
        setItems((previous) =>
          mode === "append" ? [...previous, ...result.items] : result.items,
        );
        setPage(result.page);
        setTotal(result.total);
        setTotalPages(result.totalPages);
        setHasMore(result.hasMore);
        setState("idle");
      } catch {
        if (requestId === requestRef.current) setState("error");
      }
    },
    [],
  );

  // Load the first page the first time the catalog is opened.
  useEffect(() => {
    if (expanded && items.length === 0 && state === "idle") {
      void fetchPage(1, "", "replace");
    }
    // Intentionally keyed on `expanded` only: later paging goes through the
    // buttons, and re-running on every item change would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  // Debounce the search box into a catalog query.
  useEffect(() => {
    if (!expanded) return;

    const timer = setTimeout(() => {
      if (query === appliedQuery) return;
      setAppliedQuery(query);
      void fetchPage(1, query, "replace");
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, appliedQuery, expanded, fetchPage]);

  if (!expanded) return null;

  const searching = appliedQuery !== "";

  return (
    <section aria-labelledby="catalog-heading" className="mt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3
            id="catalog-heading"
            className="text-sm font-semibold uppercase tracking-widest text-slate-400"
          >
            Explore All Markets
          </h3>
          <p className="mt-1 text-xs text-slate-600">
            {state === "loading" && items.length === 0
              ? "Loading the tradable catalog…"
              : `${total.toLocaleString()} tradable ${total === 1 ? "asset" : "assets"}${
                  searching ? ` matching “${appliedQuery}”` : ""
                }`}
          </p>
        </div>

        <label className="block">
          <span className="sr-only">Filter all tradable assets</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter all assets, e.g. TSLA or Microsoft"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/40 sm:w-80"
          />
        </label>
      </div>

      {state === "error" ? (
        <p className="mt-5 rounded-xl border border-rose-400/20 bg-rose-400/5 px-4 py-3 text-sm text-rose-300">
          Could not load the market catalog.{" "}
          <button
            type="button"
            onClick={() => void fetchPage(1, appliedQuery, "replace")}
            className="underline underline-offset-2 hover:text-rose-200"
          >
            Retry
          </button>
        </p>
      ) : items.length === 0 ? (
        <div className="mt-5 grid h-32 place-items-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02]">
          {state === "loading" ? (
            <span
              className="h-5 w-5 animate-spin rounded-full border-2 border-slate-600 border-t-transparent"
              aria-hidden="true"
            />
          ) : (
            <p className="text-sm text-slate-500">
              No tradable assets match “{appliedQuery}”
            </p>
          )}
        </div>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <li key={item.symbol}>
              <Link
                href={`/markets/${item.slug}`}
                className="group flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 transition-colors hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <span className="grid h-9 shrink-0 place-items-center rounded-lg bg-white/5 px-2.5 font-mono text-xs font-semibold text-slate-200 transition-colors group-hover:bg-emerald-400/10 group-hover:text-emerald-300">
                  {item.symbol}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-slate-300">
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-slate-600">
                    {item.kind} · {item.exchange}
                  </span>
                </span>
                <span
                  aria-hidden="true"
                  className="shrink-0 text-slate-700 transition-colors group-hover:text-emerald-400"
                >
                  &rarr;
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {hasMore && items.length > 0 ? (
        <div className="mt-5 flex items-center justify-between gap-4">
          <p className="text-xs text-slate-600">
            Showing {items.length.toLocaleString()} of{" "}
            {total.toLocaleString()}
            {searching ? " matches" : ""}
          </p>
          <button
            type="button"
            disabled={state === "loading"}
            onClick={() => void fetchPage(page + 1, appliedQuery, "append")}
            className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-emerald-400/30 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            {state === "loading" ? "Loading…" : "Load More"}
          </button>
        </div>
      ) : items.length > 0 ? (
        <p className="mt-5 text-xs text-slate-600">
          End of the list · page {page} of {totalPages.toLocaleString()}
        </p>
      ) : null}
    </section>
  );
}