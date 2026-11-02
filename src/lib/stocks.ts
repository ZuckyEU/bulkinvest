import {
  isHistoryRange,
  type HistoryRange,
  type PriceHistory,
  type PricePoint,
  type SymbolSearchResult,
} from "@/lib/market-types";

/**
 * Stock quote providers.
 *
 * Supports Finnhub (preferred) and Alpha Vantage as a fallback.
 * The provider is chosen automatically based on which API key is present,
 * or forced with STOCK_API_PROVIDER.
 */

export type StockProvider = "finnhub" | "alphavantage";

export type StockQuote = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  currency: string | null;
  industry: string | null;
  logo: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  marketCap: number | null;
  updatedAt: string;
  provider: StockProvider;
};

export class StockApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = "UPSTREAM_ERROR") {
    super(message);
    this.name = "StockApiError";
    this.status = status;
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 8000;

/** Uppercase + trim; returns null when the symbol is not plausible. */
export function normalizeSymbol(raw: string | undefined): string | null {
  if (!raw) return null;
  const symbol = raw.trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) return null;
  return symbol;
}

async function fetchJson(
  url: string,
  revalidateSeconds: number,
  extraHeaders: Record<string, string> = {},
  options: { allowNotFound?: boolean } = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", ...extraHeaders },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      next: { revalidate: revalidateSeconds },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new StockApiError(
      `Could not reach the quote provider: ${reason}`,
      504,
      "UPSTREAM_UNREACHABLE",
    );
  }

  if (response.status === 429) {
    throw new StockApiError(
      "Quote provider rate limit reached. Try again shortly.",
      429,
      "RATE_LIMITED",
    );
  }

  // Providers describe an unknown symbol differently: Yahoo answers 404 with a
  // body that still carries the reason, so history lookups opt in to reading it.
  const isAllowedNotFound =
    response.status === 404 && options.allowNotFound === true;

  if (!response.ok && !isAllowedNotFound) {
    throw new StockApiError(
      `Quote provider returned HTTP ${response.status}.`,
      502,
      "UPSTREAM_BAD_STATUS",
    );
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new StockApiError(
      "Quote provider returned an unreadable response.",
      502,
      "UPSTREAM_INVALID_JSON",
    );
  }
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && value !== "None") {
    const parsed = Number(value.replace(/[%,$]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" || trimmed === "None" || trimmed === "-" ? null : trimmed;
}

/* -------------------------------------------------------------------------- */
/* Finnhub                                                                    */
/* -------------------------------------------------------------------------- */

const FINNHUB_BASE = "https://finnhub.io/api/v1";

async function fetchFromFinnhub(
  symbol: string,
  token: string,
  revalidateSeconds: number,
): Promise<StockQuote> {
  const query = `symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;

  const [quote, profile] = await Promise.all([
    fetchJson(`${FINNHUB_BASE}/quote?${query}`, revalidateSeconds),
    // Profile is optional detail; a failure here should not break the quote.
    fetchJson(`${FINNHUB_BASE}/stock/profile2?${query}`, revalidateSeconds).catch(
      () => ({}) as Record<string, unknown>,
    ),
  ]);

  if (typeof quote.error === "string") {
    throw new StockApiError(
      "Finnhub rejected the request. Check that FINNHUB_API_KEY is valid.",
      502,
      "PROVIDER_AUTH",
    );
  }

  const price = num(quote.c);
  const timestamp = num(quote.t);
  const hasQuote = price !== null && price > 0 && timestamp !== null && timestamp > 0;

  if (!hasQuote) {
    throw new StockApiError(
      `No quote data found for "${symbol}".`,
      404,
      "SYMBOL_NOT_FOUND",
    );
  }

  return {
    symbol,
    name: str(profile.name),
    exchange: str(profile.exchange),
    currency: str(profile.currency) ?? "USD",
    industry: str(profile.finnhubIndustry),
    logo: str(profile.logo),
    price,
    change: num(quote.d),
    changePercent: num(quote.dp),
    open: num(quote.o),
    high: num(quote.h),
    low: num(quote.l),
    previousClose: num(quote.pc),
    marketCap: num(profile.marketCapitalization) !== null
      ? (num(profile.marketCapitalization) as number) * 1_000_000
      : null,
    updatedAt: new Date(timestamp * 1000).toISOString(),
    provider: "finnhub",
  };
}

/* -------------------------------------------------------------------------- */
/* Alpha Vantage                                                              */
/* -------------------------------------------------------------------------- */

const ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query";

async function fetchFromAlphaVantage(
  symbol: string,
  apiKey: string,
  revalidateSeconds: number,
): Promise<StockQuote> {
  const url = `${ALPHA_VANTAGE_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(
    symbol,
  )}&apikey=${encodeURIComponent(apiKey)}`;

  const payload = await fetchJson(url, revalidateSeconds);

  // Alpha Vantage signals problems with these keys instead of HTTP status codes.
  if (typeof payload["Error Message"] === "string") {
    throw new StockApiError(
      `No quote data found for "${symbol}".`,
      404,
      "SYMBOL_NOT_FOUND",
    );
  }
  if (typeof payload["Note"] === "string" || typeof payload["Information"] === "string") {
    throw new StockApiError(
      "Alpha Vantage rate limit reached (free tier allows 25 requests/day).",
      429,
      "RATE_LIMITED",
    );
  }

  const quote = payload["Global Quote"] as Record<string, unknown> | undefined;
  const price = num(quote?.["05. price"]);

  if (!quote || price === null) {
    throw new StockApiError(
      `No quote data found for "${symbol}".`,
      404,
      "SYMBOL_NOT_FOUND",
    );
  }

  const updatedAt = str(quote["07. latest trading day"]);

  return {
    symbol,
    name: null,
    exchange: null,
    currency: "USD",
    industry: null,
    logo: null,
    price,
    change: num(quote["09. change"]),
    changePercent: num(quote["10. change percent"]),
    open: num(quote["02. open"]),
    high: num(quote["03. high"]),
    low: num(quote["04. low"]),
    previousClose: num(quote["08. previous close"]),
    marketCap: null,
    updatedAt: updatedAt ? new Date(`${updatedAt}T00:00:00Z`).toISOString() : new Date().toISOString(),
    provider: "alphavantage",
  };
}

/* -------------------------------------------------------------------------- */
/* Public entrypoint                                                          */
/* -------------------------------------------------------------------------- */

export function resolveProvider(): { provider: StockProvider; key: string } {
  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const forced = process.env.STOCK_API_PROVIDER?.trim().toLowerCase();

  if (forced === "finnhub") {
    if (!finnhubKey) {
      throw new StockApiError(
        "STOCK_API_PROVIDER is set to finnhub but FINNHUB_API_KEY is missing.",
        500,
        "PROVIDER_NOT_CONFIGURED",
      );
    }
    return { provider: "finnhub", key: finnhubKey };
  }

  if (forced === "alphavantage") {
    if (!alphaKey) {
      throw new StockApiError(
        "STOCK_API_PROVIDER is set to alphavantage but ALPHA_VANTAGE_API_KEY is missing.",
        500,
        "PROVIDER_NOT_CONFIGURED",
      );
    }
    return { provider: "alphavantage", key: alphaKey };
  }

  if (finnhubKey) return { provider: "finnhub", key: finnhubKey };
  if (alphaKey) return { provider: "alphavantage", key: alphaKey };

  throw new StockApiError(
    "No stock API key configured. Set FINNHUB_API_KEY or ALPHA_VANTAGE_API_KEY in .env",
    500,
    "PROVIDER_NOT_CONFIGURED",
  );
}

export async function getStockQuote(
  rawSymbol: string | undefined,
  options: { revalidateSeconds?: number } = {},
): Promise<StockQuote> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) {
    throw new StockApiError(
      "Invalid ticker symbol. Use 1-15 letters, numbers, dots or dashes.",
      400,
      "INVALID_SYMBOL",
    );
  }

  const revalidateSeconds = options.revalidateSeconds ?? 30;
  const { provider, key } = resolveProvider();

  return provider === "finnhub"
    ? fetchFromFinnhub(symbol, key, revalidateSeconds)
    : fetchFromAlphaVantage(symbol, key, revalidateSeconds);
}

/* -------------------------------------------------------------------------- */
/* Symbol search (for the autocomplete)                                       */
/* -------------------------------------------------------------------------- */

/**
 * Yahoo rejects requests without a browser-like User-Agent, so we send one.
 * Quote lookups use Finnhub instead; Yahoo is only used for price history
 * because Finnhub's stock/candle endpoint requires a paid plan.
 */
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const SEARCH_CACHE_SECONDS = 300;

export async function searchSymbols(
  rawQuery: string,
  options: { limit?: number } = {},
): Promise<SymbolSearchResult[]> {
  const query = rawQuery.trim();
  if (query === "") return [];
  if (query.length > 40) {
    throw new StockApiError(
      "Search query is too long.",
      400,
      "INVALID_QUERY",
    );
  }

  const limit = Math.min(Math.max(options.limit ?? 10, 1), 25);

  const finnhubKey = process.env.FINNHUB_API_KEY?.trim();
  const alphaKey = process.env.ALPHA_VANTAGE_API_KEY?.trim();
  const forced = process.env.STOCK_API_PROVIDER?.trim().toLowerCase();

  const useAlpha =
    (forced === "alphavantage" && alphaKey) || (!finnhubKey && alphaKey);

  if (useAlpha && alphaKey) {
    const url = `${ALPHA_VANTAGE_BASE}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(
      query,
    )}&apikey=${encodeURIComponent(alphaKey)}`;
    const payload = await fetchJson(url, SEARCH_CACHE_SECONDS, {
      "User-Agent": BROWSER_USER_AGENT,
    });
    const matches = Array.isArray(payload.bestMatches) ? payload.bestMatches : [];
    return matches
      .map((entry) => {
        const row = entry as Record<string, unknown>;
        const symbol = str(row["1. symbol"]);
        if (!symbol) return null;
        return {
          symbol: symbol.toUpperCase(),
          name: str(row["2. name"]) ?? symbol.toUpperCase(),
          type: str(row["3. type"]),
        };
      })
      .filter((row): row is SymbolSearchResult => row !== null)
      .slice(0, limit);
  }

  if (!finnhubKey) {
    throw new StockApiError(
      "No stock API key configured. Set FINNHUB_API_KEY or ALPHA_VANTAGE_API_KEY in .env",
      500,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  const url = `${FINNHUB_BASE}/search?q=${encodeURIComponent(
    query,
  )}&token=${encodeURIComponent(finnhubKey)}`;

  const payload = await fetchJson(url, SEARCH_CACHE_SECONDS, {
    "User-Agent": BROWSER_USER_AGENT,
  });

  if (typeof payload.error === "string") {
    throw new StockApiError(
      "Finnhub rejected the search request. Check that FINNHUB_API_KEY is valid.",
      502,
      "PROVIDER_AUTH",
    );
  }

  const results = Array.isArray(payload.result) ? payload.result : [];

  return results
    .map((entry) => {
      const row = entry as Record<string, unknown>;
      const symbol = str(row.displaySymbol) ?? str(row.symbol);
      if (!symbol) return null;
      return {
        symbol: symbol.toUpperCase(),
        name: str(row.description) ?? symbol.toUpperCase(),
        type: str(row.type),
      };
    })
    .filter((row): row is SymbolSearchResult => row !== null)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* Historical prices (for the chart)                                          */
/* -------------------------------------------------------------------------- */

type YahooRangeConfig = { range: string; interval: string };

const YAHOO_RANGE_MAP: Record<HistoryRange, YahooRangeConfig> = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "30m" },
  "1M": { range: "1mo", interval: "1d" },
  "3M": { range: "3mo", interval: "1d" },
  "6M": { range: "6mo", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
  MAX: { range: "max", interval: "1mo" },
};

export function normalizeRange(raw: string | null | undefined): HistoryRange {
  if (!raw) return "1Y";
  const upper = raw.trim().toUpperCase();
  return isHistoryRange(upper) ? upper : "1Y";
}

const HISTORY_CACHE_SECONDS = 300;

export async function getPriceHistory(
  rawSymbol: string | undefined,
  rangeInput: string | null | undefined,
  options: { revalidateSeconds?: number } = {},
): Promise<PriceHistory> {
  const symbol = normalizeSymbol(rawSymbol);
  if (!symbol) {
    throw new StockApiError(
      "Invalid ticker symbol. Use 1-15 letters, numbers, dots or dashes.",
      400,
      "INVALID_SYMBOL",
    );
  }

  const range = normalizeRange(rangeInput);
  const config = YAHOO_RANGE_MAP[range];
  const revalidateSeconds = options.revalidateSeconds ?? HISTORY_CACHE_SECONDS;

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=${config.range}&interval=${config.interval}&includePrePost=false`;

  const payload = await fetchJson(
    url,
    revalidateSeconds,
    { "User-Agent": BROWSER_USER_AGENT },
    { allowNotFound: true },
  );

  const chart = payload.chart as Record<string, unknown> | undefined;

  if (chart?.error) {
    const description = str(
      (chart.error as Record<string, unknown>).description,
    );
    throw new StockApiError(
      description
        ? `No price history for "${symbol}": ${description}`
        : `No price history found for "${symbol}".`,
      404,
      "SYMBOL_NOT_FOUND",
    );
  }

  const results = Array.isArray(chart?.result) ? chart.result : [];
  const result = results[0] as Record<string, unknown> | undefined;

  if (!result) {
    throw new StockApiError(
      `No price history found for "${symbol}".`,
      404,
      "SYMBOL_NOT_FOUND",
    );
  }

  const meta = (result.meta ?? {}) as Record<string, unknown>;
  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];

  const indicators = (result.indicators ?? {}) as Record<string, unknown>;
  const quoteList = Array.isArray(indicators.quote) ? indicators.quote : [];
  const quote = (quoteList[0] ?? {}) as Record<string, unknown>;

  const asArray = (value: unknown): unknown[] =>
    Array.isArray(value) ? value : [];

  const opens = asArray(quote.open);
  const highs = asArray(quote.high);
  const lows = asArray(quote.low);
  const closes = asArray(quote.close);
  const volumes = asArray(quote.volume);

  const points: PricePoint[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const timestamp = num(timestamps[index]);
    const close = num(closes[index]);
    // Yahoo pads gaps (halts, missing sessions) with nulls; skip those rows.
    if (timestamp === null || close === null) continue;

    points.push({
      date: new Date(timestamp * 1000).toISOString(),
      open: num(opens[index]),
      high: num(highs[index]),
      low: num(lows[index]),
      close,
      volume: num(volumes[index]),
    });
  }

  if (points.length === 0) {
    throw new StockApiError(
      `No price history found for "${symbol}".`,
      404,
      "SYMBOL_NOT_FOUND",
    );
  }

  const first = points[0].close;
  const latestPrice = num(meta.regularMarketPrice) ?? points[points.length - 1].close;
  const rangeChange = latestPrice - first;

  return {
    symbol,
    currency: str(meta.currency) ?? "USD",
    range,
    interval: config.interval,
    points,
    latestPrice,
    rangeChange,
    rangeChangePercent: first === 0 ? 0 : (rangeChange / first) * 100,
    fiftyTwoWeekHigh: num(meta.fiftyTwoWeekHigh) ?? null,
    fiftyTwoWeekLow: num(meta.fiftyTwoWeekLow) ?? null,
    provider: "yahoo",
  };
}

/* -------------------------------------------------------------------------- */
/* Batch quotes                                                               */
/* -------------------------------------------------------------------------- */

export type BatchQuotes = {
  quotes: StockQuote[];
  errors: { symbol: string; error: string }[];
};

/**
 * Fetches quotes for several symbols concurrently.
 *
 * Never throws for individual failures: a symbol that cannot be priced is
 * reported in `errors` so one bad ticker does not break a whole portfolio.
 */
export async function getQuotes(rawSymbols: string[]): Promise<BatchQuotes> {
  const symbols = Array.from(
    new Set(
      rawSymbols
        .map((symbol) => normalizeSymbol(symbol))
        .filter((symbol): symbol is string => symbol !== null),
    ),
  );

  const settled = await Promise.allSettled(
    symbols.map((symbol) => getStockQuote(symbol)),
  );

  const quotes: StockQuote[] = [];
  const errors: { symbol: string; error: string }[] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      quotes.push(result.value);
    } else {
      errors.push({
        symbol: symbols[index],
        error:
          result.reason instanceof Error
            ? result.reason.message
            : "Unknown quote error",
      });
    }
  });

  return { quotes, errors };
}
