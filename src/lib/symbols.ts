/**
 * Ticker helpers shared by the client and server.
 *
 * Alpaca is inconsistent about crypto pair formatting: positions come back as
 * `BTCUSD` while orders and our own API use `BTC/USD`. Comparing or linking the
 * two naively would fail to match a user's BTC holding, so all symbol
 * comparisons go through `matchesSymbol` and all internal links through
 * `toAssetSlug` / `fromAssetSlug`.
 */

/** `BTC/USD` -> `BTC-USD`; equity tickers are returned unchanged. */
export function toAssetSlug(symbol: string): string {
  return symbol.trim().replace(/\//g, "-");
}

/**
 * `BTC-USD` -> `BTC/USD`.
 *
 * Only `-USD` suffixed slugs are treated as crypto pairs, so a class-share
 * ticker such as `BRK-B` is left alone.
 */
export function fromAssetSlug(slug: string): string {
  const trimmed = slug.trim().toUpperCase();
  return /^[A-Z]{2,10}-USD$/.test(trimmed) ? trimmed.replace("-", "/") : trimmed;
}

/** True for a crypto pair rather than an equity ticker. */
export function isCryptoSymbol(symbol: string): boolean {
  return symbol.includes("/");
}

/**
 * Compare two tickers ignoring the slash crypto pairs are sometimes written
 * with, e.g. `BTC/USD` matches `BTCUSD`.
 */
export function matchesSymbol(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return canonicalSymbol(a) === canonicalSymbol(b);
}

function canonicalSymbol(symbol: string): string {
  return symbol.trim().replace(/\//g, "").toUpperCase();
}

/**
 * Format an order quantity for display and for prefilling the ticket.
 *
 * Crypto holdings are fractional, so a fixed 2dp money format would render
 * `0.00`. The precision is chosen as the shortest fixed-point form that parses
 * back to exactly the same number: rounding here would either hide a dust
 * balance as `0` or round a balance *up*, producing an order larger than the
 * position the broker will accept.
 */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value === 0) return "0";

  if (Number.isInteger(value) && Math.abs(value) < 1e15) {
    return value.toLocaleString("en-US");
  }

  for (let digits = 4; digits <= 12; digits += 1) {
    const text = value.toFixed(digits);
    if (Number(text) === value) return trimTrailingZeros(text);
  }

  return String(value);
}

function trimTrailingZeros(text: string): string {
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}