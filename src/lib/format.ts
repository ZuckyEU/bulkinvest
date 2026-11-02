/**
 * Shared display formatting. Pure functions, safe on server and client.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export const formatUSD = (value: number) => usdFormatter.format(value);

export const formatCompactUSD = (value: number) =>
  compactUsdFormatter.format(value);

export const formatSignedUSD = (value: number) =>
  `${value >= 0 ? "+" : "-"}${usdFormatter.format(Math.abs(value))}`;

export const formatPercent = (value: number, signed = false) =>
  `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%`;

export const formatDate = (iso: string) => dateFormatter.format(new Date(iso));

export const formatDateTime = (iso: string) =>
  dateTimeFormatter.format(new Date(iso));

const sharesFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 6,
});

/** Trims trailing zeros so 10 renders as "10" and 10.5 as "10.5". */
export const formatShares = (value: number) => sharesFormatter.format(value);
