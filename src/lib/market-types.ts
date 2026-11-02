/**
 * Isomorphic market types and constants.
 *
 * Safe to import from client components: this module contains no fetching
 * logic and no environment access, so it never drags server code (or API
 * keys) into the browser bundle.
 */

export const HISTORY_RANGES = [
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "1Y",
  "5Y",
  "MAX",
] as const;

export type HistoryRange = (typeof HISTORY_RANGES)[number];

export const DEFAULT_HISTORY_RANGE: HistoryRange = "1Y";

/** Human-readable description of each range, for chart subtitles. */
export const RANGE_DESCRIPTIONS: Record<HistoryRange, string> = {
  "1D": "past day",
  "5D": "past 5 days",
  "1M": "past month",
  "3M": "past 3 months",
  "6M": "past 6 months",
  "1Y": "past year",
  "5Y": "past 5 years",
  MAX: "all time",
};

export function isHistoryRange(value: string): value is HistoryRange {
  return (HISTORY_RANGES as readonly string[]).includes(value);
}

export type SymbolSearchResult = {
  symbol: string;
  name: string;
  type: string | null;
};

export type PricePoint = {
  /** ISO timestamp of the candle. */
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

export type PriceHistory = {
  symbol: string;
  currency: string;
  range: HistoryRange;
  interval: string;
  points: PricePoint[];
  latestPrice: number;
  rangeChange: number;
  rangeChangePercent: number;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  provider: "yahoo";
};
