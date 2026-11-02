import { getQuotes } from "@/lib/stocks";
import { getCryptoQuote, isAlpacaConfigured } from "@/lib/alpaca";
import { nameForSymbol } from "@/lib/asset-names";

/**
 * The curated set of assets shown on the Markets landing grid.
 *
 * Prices come from two different providers because the equity provider has no
 * crypto coverage: equities via the configured quote provider (Finnhub /
 * Alpha Vantage) and crypto pairs via Alpaca. Names are pinned here rather than
 * resolved per-request so the grid renders even when a provider is rate limited.
 */

export type FeaturedCategory = "equities" | "crypto";

export type FeaturedAsset = {
  symbol: string;
  name: string;
  category: FeaturedCategory;
};

export const FEATURED_EQUITIES: readonly FeaturedAsset[] = [
  { symbol: "AAPL", name: "Apple Inc.", category: "equities" },
  { symbol: "NVDA", name: "NVIDIA Corp.", category: "equities" },
  { symbol: "MSFT", name: "Microsoft Corp.", category: "equities" },
  { symbol: "TSLA", name: "Tesla Inc.", category: "equities" },
  { symbol: "AMZN", name: "Amazon.com, Inc.", category: "equities" },
  { symbol: "GOOGL", name: "Alphabet Inc.", category: "equities" },
];

export const FEATURED_CRYPTO: readonly FeaturedAsset[] = [
  { symbol: "BTC/USD", name: "Bitcoin", category: "crypto" },
  { symbol: "ETH/USD", name: "Ethereum", category: "crypto" },
  { symbol: "SOL/USD", name: "Solana", category: "crypto" },
];

export const FEATURED_ASSETS: readonly FeaturedAsset[] = [
  ...FEATURED_EQUITIES,
  ...FEATURED_CRYPTO,
];

/** A featured asset plus whatever live pricing could be obtained for it. */
export type FeaturedQuote = FeaturedAsset & {
  /** Last price, or null when no provider could price it. */
  price: number | null;
  /** Percent change vs the previous close (24h for crypto). */
  changePercent: number | null;
  /** Absolute change, derived from the percent when available. */
  change: number | null;
  previousClose: number | null;
};

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Price every featured asset.
 *
 * Equity and crypto legs are independent, and each asset is settled on its own,
 * so a single provider failure degrades to "no price" for that asset rather than
 * an empty page.
 */
export async function getFeaturedQuotes(): Promise<FeaturedQuote[]> {
  const equitySymbols = FEATURED_EQUITIES.map((asset) => asset.symbol);

  const [equityResult, cryptoQuotes] = await Promise.all([
    // getQuotes never rejects: unpriceable tickers land in `errors`.
    getQuotes(equitySymbols).catch(() => ({
      quotes: [],
      errors: [] as { symbol: string; error: string }[],
    })),
    Promise.all(
      FEATURED_CRYPTO.map(async (asset) => {
        if (!isAlpacaConfigured()) {
          return [asset.symbol, null] as const;
        }
        const quote = await getCryptoQuote(asset.symbol);
        return [asset.symbol, quote] as const;
      }),
    ),
  ]);

  const equitiesBySymbol = new Map(
    equityResult.quotes.map((quote) => [quote.symbol, quote]),
  );
  const cryptoBySymbol = new Map(cryptoQuotes);

  return FEATURED_ASSETS.map((asset) => {
    if (asset.category === "crypto") {
      const quote = cryptoBySymbol.get(asset.symbol);
      const price = quote?.price ?? null;
      const changePercent = quote?.changePercent ?? null;

      return {
        ...asset,
        price,
        changePercent: changePercent === null ? null : round(changePercent),
        change:
          price !== null && changePercent !== null
            ? round((price * changePercent) / 100)
            : null,
        previousClose: quote?.previousClose ?? null,
      };
    }

    const quote = equitiesBySymbol.get(asset.symbol);
    const price = quote?.price ?? null;
    const changePercent = quote?.changePercent ?? null;
    const change = quote?.change ?? null;

    return {
      // Prefer the provider's name, fall back to the curated label.
      ...asset,
      name: quote?.name?.trim() || asset.name || nameForSymbol(asset.symbol),
      price,
      changePercent: changePercent === null ? null : round(changePercent),
      change: change === null ? null : round(change),
      previousClose: quote?.previousClose ?? null,
    };
  });
}