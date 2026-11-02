import { getStockQuote } from "@/lib/stocks";
import { isCryptoSymbol } from "@/lib/symbols";

/**
 * Human-readable asset names for positions.
 *
 * Alpaca reports a position by ticker only (`AAPL`, `BTCUSD`), but the holdings
 * table needs to show "AAPL - Apple Inc.". Equities resolve through the quote
 * provider; crypto pairs resolve from a static map because the equity providers
 * have no listing for them.
 *
 * Results are cached in-process for an hour: a company's name barely changes,
 * and re-asking the provider on every 30-second portfolio refresh would burn
 * rate limit for nothing.
 */

const NAME_CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { name: string | null; expiresAt: number }>();

/** Crypto pairs the app supports, keyed by the bare ticker. */
const CRYPTO_NAMES: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  DOGE: "Dogecoin",
  USDT: "Tether USD",
  USDC: "USD Coin",
  AVAX: "Avalanche",
  LINK: "Chainlink",
  LTC: "Litecoin",
  BCH: "Bitcoin Cash",
  XRP: "XRP",
  ADA: "Cardano",
};

/**
 * Fallback for an unrecognised equity ticker: the ticker itself is better than
 * an empty cell, and a wrong-but-plausible name would be worse than either.
 */
export function nameForSymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();

  if (isCryptoSymbol(upper)) {
    const base = upper.split("/")[0];
    return CRYPTO_NAMES[base] ?? `${base} (${upper.split("/")[1] ?? "USD"})`;
  }

  return upper;
}

/**
 * Resolve one asset name, or null when the provider cannot name it.
 *
 * Never throws: a missing name must not fail a holdings render.
 */
export async function resolveAssetName(symbol: string): Promise<string | null> {
  const upper = symbol.trim().toUpperCase();

  // Crypto never needs the network round-trip.
  if (isCryptoSymbol(upper)) return nameForSymbol(upper);

  const cached = cache.get(upper);
  if (cached && cached.expiresAt > Date.now()) return cached.name;

  // Negative results are cached too, so a ticker the provider does not know is
  // not retried on every refresh. The TTL means a later fix still takes effect.
  const remember = (name: string | null) => {
    cache.set(upper, { name, expiresAt: Date.now() + NAME_CACHE_MS });
    return name;
  };

  try {
    const quote = await getStockQuote(upper, { revalidateSeconds: 3600 });
    return remember(quote.name?.trim() || null);
  } catch {
    return remember(null);
  }
}

/**
 * Resolve names for many positions at once.
 *
 * Positions sharing a ticker (e.g. two crypto pairs) resolve once. Unknown
 * symbols fall back to the ticker so the table always has something to show.
 */
export async function resolveAssetNames(
  symbols: string[],
): Promise<Record<string, string | null>> {
  const unique = Array.from(new Set(symbols.map((s) => s.trim().toUpperCase())));

  const resolved = await Promise.all(
    unique.map(async (symbol) => {
      const name = await resolveAssetName(symbol);
      return [symbol, name] as const;
    }),
  );

  return Object.fromEntries(resolved);
}