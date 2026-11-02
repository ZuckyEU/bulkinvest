"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { SymbolSearchResult } from "@/lib/market-types";

export type StockSearchOption = SymbolSearchResult;

type StockSearchProps = {
  onSelect: (option: StockSearchOption) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /**
   * Fires as the user types, so a parent can stand down while the dropdown is
   * in use (e.g. hiding the featured grid on the Markets page).
   */
  onQueryChange?: (query: string) => void;
};

const DEBOUNCE_MS = 250;

export function StockSearch({
  onSelect,
  placeholder = "Search a ticker or company, e.g. AAPL",
  autoFocus = false,
  onQueryChange,
}: StockSearchProps) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<StockSearchOption[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Notify the parent of every keystroke (the value it cares about is the
  // trimmed query, so clearing the box restores the parent's default view).
  useEffect(() => {
    onQueryChange?.(query.trim());
  }, [query, onQueryChange]);

  // Debounced lookup. Aborting the in-flight request prevents an older
  // response from overwriting results for a newer query.
  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed === "") {
      setOptions([]);
      setIsOpen(false);
      setIsLoading(false);
      setError(null);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/stocks/search?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const body = await response.json();

        if (!response.ok) {
          throw new Error(body?.error ?? "Search failed.");
        }

        setOptions(Array.isArray(body?.results) ? body.results : []);
        setError(null);
        setIsOpen(true);
        setActiveIndex(-1);
      } catch (caught) {
        if (controller.signal.aborted) return;
        setOptions([]);
        setError(caught instanceof Error ? caught.message : "Search failed.");
        setIsOpen(true);
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query]);

  // Close when clicking outside the combobox.
  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function commit(option: StockSearchOption) {
    setQuery("");
    setOptions([]);
    setIsOpen(false);
    setActiveIndex(-1);
    onSelect(option);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(options.length > 0);
        return;
      }
      if (options.length === 0) return;

      setActiveIndex((current) => {
        const next = event.key === "ArrowDown" ? current + 1 : current - 1;
        if (next < 0) return options.length - 1;
        if (next >= options.length) return 0;
        return next;
      });
      return;
    }

    if (event.key === "Enter") {
      const choice = options[activeIndex];
      if (isOpen && choice) {
        event.preventDefault();
        commit(choice);
      }
    }
  }

  const showPanel = isOpen && query.trim() !== "";

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        >
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="2" />
          <path
            d="m16 16 4.5 4.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          autoFocus={autoFocus}
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (options.length > 0) setIsOpen(true);
          }}
          className="w-full rounded-xl border border-white/10 bg-white/[0.03] py-3.5 pl-11 pr-11 text-sm text-white placeholder:text-slate-500 focus:border-emerald-400/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/20"
        />

        {isLoading ? (
          <span
            className="absolute right-4 top-1/2 block h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-slate-600 border-t-transparent"
            aria-hidden="true"
          />
        ) : null}
      </div>

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#0a0e18] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl"
        >
          {error ? (
            <p className="px-3 py-3 text-sm text-rose-400">{error}</p>
          ) : options.length === 0 && !isLoading ? (
            <p className="px-3 py-3 text-sm text-slate-500">
              No matches for &ldquo;{query.trim()}&rdquo;
            </p>
          ) : (
            options.map((option, index) => (
              <button
                key={`${option.symbol}-${index}`}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(option)}
                className={`flex w-full items-center justify-between gap-4 rounded-lg px-3 py-2.5 text-left transition-colors ${
                  index === activeIndex ? "bg-white/10" : "hover:bg-white/5"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="w-16 shrink-0 font-mono text-sm font-semibold text-white">
                    {option.symbol}
                  </span>
                  <span className="truncate text-sm text-slate-400">
                    {option.name}
                  </span>
                </span>
                {option.type ? (
                  <span className="shrink-0 text-xs text-slate-600">
                    {option.type}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
