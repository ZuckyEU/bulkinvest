import { getAlpacaAssets, isAlpacaConfigured, type AlpacaAsset } from "@/lib/alpaca";
import { isCryptoSymbol, toAssetSlug } from "@/lib/symbols";

/**
 * The full tradable-asset catalog behind "Explore All Markets".
 *
 * Alpaca's `/v2/assets` endpoint returns every active instrument it knows about
 * (14k+ rows, dominated by micro-caps and structured products) and carries no
 * volume, market-cap or popularity signal. So "top tradable" is produced by
 * ordering: a curated prefix of genuinely liquid names first, then everything
 * else alphabetically. Alphabetical is used deliberately — it is predictable, it
 * lets a user find anything beginning with a given letter, and the search box
 * jumps straight to an exact name.
 */

export type CatalogCategory = "equity" | "crypto";

export type CatalogItem = {
  symbol: string;
  name: string;
  /** Route slug for the asset detail page (crypto uses "BTC-USD"). */
  slug: string;
  exchange: string;
  category: CatalogCategory;
  /** Instrument family, e.g. "Common Stock", "ETF", "Crypto". */
  kind: string;
  fractionable: boolean;
};

/**
 * Liquid names promoted to the front of the catalog, in browse order.
 *
 * The broker gives us no way to rank by liquidity, so this list is the ranking.
 */
const CURATED_PRIORITY: readonly string[] = [
  "AAPL",
  "NVDA",
  "MSFT",
  "TSLA",
  "AMZN",
  "GOOGL",
  "META",
  "NFLX",
  "AMD",
  "INTC",
  "PYPL",
  "COIN",
  "PLTR",
  "BTC/USD",
  "ETH/USD",
  "SOL/USD",
];

/**
 * Instrument families that are tradable but are not really "a stock you would
 * browse for" — plus the handful of common-stock look-alikes Alpaca files under
 * a security class suffix.
 *
 * ETFs are deliberately kept (SPY/QQQ are among the most-traded symbols
 * available) and tagged as such rather than filtered out.
 */
const NON_COMMON_EQUITY =
  /warrant|\bunit\b|\brights?\b|debenture|\bnotes\b|when[- ]issued|\bsp\b/i;

/** Classifies an equity by name so the UI can label it without another lookup. */
function equityKind(name: string): string {
  if (/\bwarrant\b/i.test(name)) return "Warrant";
  if (/\brights?\b/i.test(name)) return "Rights";
  if (/\bunit\b/i.test(name)) return "Unit";
  if (/debenture|\bnotes?\b/i.test(name)) return "Notes";
  // Alpaca appends the instrument family to the company name
  // ("Columbia AAA CLO ETF"), so a trailing "ETF" is the common signal.
  if (/\betf\b|exchange[- ]traded|\bfunds?\b|\btrust\b/i.test(name)) return "ETF";
  return "Common Stock";
}

function toItem(asset: AlpacaAsset): CatalogItem | null {
  const symbol = asset.symbol.trim();
  if (!symbol) return null;

  const isCrypto = asset.assetClass === "crypto" || isCryptoSymbol(symbol);
  const name = (asset.name ?? "").trim();

  if (isCrypto) {
    // Alpaca lists each coin in several quote currencies (BTC/USD, BTC/USDT,
    // BTC/USDC...). Only the USD pairs are tradeable through this app, so the
    // others would just be duplicate-looking rows.
    if (!symbol.endsWith("/USD")) return null;
    if (NON_COMMON_EQUITY.test(name)) return null;

    return {
      symbol,
      name: name || symbol.split("/")[0],
      slug: toAssetSlug(symbol),
      exchange: "CRYPTO",
      category: "crypto",
      kind: "Crypto",
      fractionable: asset.fractionable,
    };
  }

  // Over-the-counter instruments are technically tradable but are a different
  // market from the exchange-listed screen this page advertises.
  if (asset.exchange === "OTC") return null;
  if (NON_COMMON_EQUITY.test(name)) return null;

  return {
    symbol,
    name: name || symbol,
    slug: toAssetSlug(symbol),
    exchange: asset.exchange ?? "—",
    category: "equity",
    kind: equityKind(name),
    fractionable: asset.fractionable,
  };
}

/**
 * Filters and orders the broker's asset list into the browsable catalog.
 *
 * Exported for tests; the app goes through `getCatalogPage`.
 */
export function buildCatalog(assets: readonly AlpacaAsset[]): CatalogItem[] {
  const items: CatalogItem[] = [];
  const seen = new Set<string>();

  for (const asset of assets) {
    if (!asset.tradable) continue;
    const item = toItem(asset);
    if (!item || seen.has(item.symbol)) continue;
    seen.add(item.symbol);
    items.push(item);
  }

  // The curated prefix wins, in its declared order, and only for symbols that
  // actually survived filtering; everything else follows alphabetically.
  const bySymbol = new Map(items.map((item) => [item.symbol, item]));
  const front = CURATED_PRIORITY.flatMap((symbol) => {
    const item = bySymbol.get(symbol);
    return item ? [item] : [];
  });
  const frontSet = new Set(front.map((item) => item.symbol));

  const rest = items
    .filter((item) => !frontSet.has(item.symbol))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));

  return [...front, ...rest];
}

/* --------------------------------- caching --------------------------------- */

/**
 * The asset list is large and slow (seconds) but changes rarely, so it is held
 * in-process and refreshed on a long TTL. A stale value is still served while a
 * refresh runs, so no request ever pays the full upstream latency twice.
 */
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour

type CacheEntry = { items: CatalogItem[]; fetchedAt: number };

let cache: CacheEntry | null = null;
let inFlight: Promise<CatalogItem[]> | null = null;

async function fetchCatalog(): Promise<CatalogItem[]> {
  if (!inFlight) {
    inFlight = getAlpacaAssets("active")
      .then(buildCatalog)
      .then((items) => {
        cache = { items, fetchedAt: Date.now() };
        return items;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * The whole catalog, cached.
 *
 * Returns an empty list when the broker is unreachable or unconfigured so
 * callers can degrade instead of throwing.
 */
export async function getCatalog(): Promise<CatalogItem[]> {
  if (!isAlpacaConfigured()) return [];

  if (cache) {
    if (Date.now() - cache.fetchedAt < CATALOG_TTL_MS) return cache.items;

    // Stale-but-usable: serve immediately and refresh in the background.
    void fetchCatalog().catch(() => undefined);
    return cache.items;
  }

  try {
    return await fetchCatalog();
  } catch (error) {
    console.warn("Could not load the asset catalog:", error);
    return [];
  }
}

/* -------------------------------- pagination -------------------------------- */

export const CATALOG_PAGE_SIZE = 12;
export const CATALOG_MAX_PAGE_SIZE = 48;

/** Filters the catalog by ticker or company name, case-insensitively. */
function matchesQuery(item: CatalogItem, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return (
    item.symbol.toLowerCase().includes(needle) ||
    item.name.toLowerCase().includes(needle)
  );
}

export type CatalogPage = {
  items: CatalogItem[];
  page: number;
  limit: number;
  /** Matches for the current query, across the whole catalog. */
  total: number;
  totalPages: number;
  hasMore: boolean;
  query: string;
};

export class CatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogError";
  }
}

/** Clamps and validates `?page` / `?limit` so a hostile query cannot allocate. */
export function parsePageParams(raw: {
  page?: string | null;
  limit?: string | null;
  q?: string | null;
}): { page: number; limit: number; query: string } {
  const { page: rawPage, limit: rawLimit, q } = raw;

  let page = 1;
  if (rawPage != null && rawPage !== "") {
    page = Number(rawPage);
    if (!Number.isInteger(page) || page < 1) {
      throw new CatalogError("`page` must be a positive integer.");
    }
  }

  let limit = CATALOG_PAGE_SIZE;
  if (rawLimit != null && rawLimit !== "") {
    limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > CATALOG_MAX_PAGE_SIZE) {
      throw new CatalogError(
        `\`limit\` must be an integer between 1 and ${CATALOG_MAX_PAGE_SIZE}.`,
      );
    }
  }

  return { page, limit, query: (q ?? "").trim().slice(0, 80) };
}

/** One page of the catalog, optionally filtered by `query`. */
export async function getCatalogPage(params: {
  page: number;
  limit: number;
  query?: string;
}): Promise<CatalogPage> {
  const catalog = await getCatalog();
  const query = (params.query ?? "").trim();

  const matches = query === "" ? catalog : catalog.filter((item) => matchesQuery(item, query));

  const total = matches.length;
  const totalPages = Math.max(1, Math.ceil(total / params.limit));
  const start = (params.page - 1) * params.limit;

  return {
    items: matches.slice(start, start + params.limit),
    page: params.page,
    limit: params.limit,
    total,
    totalPages,
    // Nothing past the end is worth fetching.
    hasMore: start + params.limit < total,
    query,
  };
}