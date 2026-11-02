import { Alpaca, TimeFrame } from "@alpacahq/alpaca-trade-api";
import type {
  AlpacaAccount,
  AlpacaPosition,
  PendingOrder,
  PortfolioSnapshot,
} from "@/lib/portfolio-types";
import { nameForSymbol, resolveAssetNames } from "@/lib/asset-names";

export type { AlpacaAccount, AlpacaPosition, PendingOrder, PortfolioSnapshot };

/**
 * Alpaca trading client.
 *
 * Credentials come from ALPACA_API_KEY / ALPACA_SECRET_KEY. ALPACA_PAPER
 * defaults to `true`, so unless it is explicitly "false" every order and read
 * targets the paper environment.
 *
 * Alpaca is the source of truth for cash, buying power and positions. Equities
 * (AAPL) and crypto pairs (BTC/USD) go through the same Orders API; crypto is
 * 24/7 and requires a "gtc" time-in-force, which this module applies.
 */

export class AlpacaError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 502, code = "ALPACA_ERROR") {
    super(message);
    this.name = "AlpacaError";
    this.status = status;
    this.code = code;
  }
}

function createClient() {
  const keyId = process.env.ALPACA_API_KEY?.trim();
  const secret = process.env.ALPACA_SECRET_KEY?.trim();
  // Only an explicit "false" switches off paper trading.
  const paper = process.env.ALPACA_PAPER?.trim().toLowerCase() !== "false";
  return new Alpaca({ keyId, secret, paper, timeoutMs: 20_000 });
}

export type AlpacaClient = ReturnType<typeof createClient>;

export function isAlpacaConfigured(): boolean {
  return (
    (process.env.ALPACA_API_KEY?.trim() ?? "") !== "" &&
    (process.env.ALPACA_SECRET_KEY?.trim() ?? "") !== ""
  );
}

export function isPaperTrading(): boolean {
  return process.env.ALPACA_PAPER?.trim().toLowerCase() !== "false";
}

export function getAlpacaClient(): AlpacaClient | null {
  return isAlpacaConfigured() ? createClient() : null;
}

function clientOrThrow(): AlpacaClient {
  const client = getAlpacaClient();
  if (!client) {
    throw new AlpacaError(
      "Trading is not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY.",
      503,
      "ALPACA_NOT_CONFIGURED",
    );
  }
  return client;
}

/* ------------------------------- symbols ---------------------------------- */

/** Crypto pairs carry a slash ("BTC/USD"); everything else is an equity. */
export function isCryptoSymbol(symbol: string): boolean {
  return symbol.includes("/");
}

/**
 * Normalise a ticker. Equities are uppercased; a bare crypto base (BTC) is
 * expanded to its USD pair so callers do not have to know the convention.
 */
export function normalizeAlpacaSymbol(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (trimmed === "") {
    throw new AlpacaError("A symbol is required.", 400, "INVALID_SYMBOL");
  }
  if (isCryptoSymbol(trimmed)) {
    if (!/^[A-Z0-9]{2,10}\/[A-Z0-9]{2,10}$/.test(trimmed)) {
      throw new AlpacaError(
        `Invalid crypto pair "${raw}". Use BASE/QUOTE, e.g. BTC/USD.`,
        400,
        "INVALID_SYMBOL",
      );
    }
    return trimmed;
  }
  if (!/^[A-Z0-9.\-]{1,15}$/.test(trimmed)) {
    throw new AlpacaError(
      `Invalid ticker "${raw}". Use 1-15 letters, numbers, dots or dashes.`,
      400,
      "INVALID_SYMBOL",
    );
  }
  return trimmed;
}

/** Time-in-force: crypto must be gtc; equities default to day. */
function defaultTimeInForce(symbol: string): "gtc" | "day" {
  return isCryptoSymbol(symbol) ? "gtc" : "day";
}

/* -------------------------------- helpers --------------------------------- */

function toNum(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Alpaca returns crypto *positions* as "BTCUSD" but expects "BTC/USD" when
 * placing orders. Normalise the display form so the dashboard matches what the
 * trade ticket and search use.
 */
function displaySymbol(symbol: string, assetClass: string | null): string {
  if (assetClass === "crypto" && !symbol.includes("/")) {
    const match = /^([A-Z0-9]{2,10}?)(USD|USDT|USDC|EUR|GBP)$/.exec(symbol);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return symbol;
}

/** Map SDK/network failures onto a consistent, safe error. */
export function toAlpacaError(error: unknown): AlpacaError {
  if (error instanceof AlpacaError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("forbidden")) {
    return new AlpacaError(
      "Alpaca rejected the credentials. Check ALPACA_API_KEY / ALPACA_SECRET_KEY.",
      502,
      "ALPACA_AUTH",
    );
  }
  if (
    lower.includes("insufficient") ||
    lower.includes("buying power") ||
    lower.includes("403") ||
    lower.includes("not allowed") ||
    lower.includes("422")
  ) {
    return new AlpacaError(`Alpaca rejected the order: ${message}`, 400, "ALPACA_REJECTED");
  }
  if (lower.includes("timeout") || lower.includes("fetch failed") || lower.includes("econnrefused")) {
    return new AlpacaError(`Could not reach Alpaca: ${message}`, 504, "ALPACA_UNREACHABLE");
  }
  return new AlpacaError(`Alpaca request failed: ${message}`, 502, "ALPACA_ERROR");
}

/* --------------------------------- account -------------------------------- */

export async function getAlpacaAccount(): Promise<AlpacaAccount> {
  const client = clientOrThrow();
  try {
    const account = await client.trading.account.getAccount();
    return {
      cash: toNum(account.cash),
      buyingPower: toNum(account.buyingPower),
      equity: toNum(account.equity),
      lastEquity: toNum(account.lastEquity),
      portfolioValue: toNum(account.portfolioValue),
      currency: account.currency ?? null,
      status: account.status ?? null,
      cryptoStatus: account.cryptoStatus ?? null,
      tradingBlocked: account.tradingBlocked === true,
      accountBlocked: account.accountBlocked === true,
    };
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/* -------------------------------- positions ------------------------------- */

export async function getAlpacaPositions(): Promise<AlpacaPosition[]> {
  const client = clientOrThrow();
  try {
    const positions = await client.trading.positions.getAllOpenPositions();

    return positions.map((position) => {
      const qty = toNum(position.qty) ?? 0;
      const currentPrice = toNum(position.currentPrice);
      const lastdayPrice = toNum(position.lastdayPrice);
      const costBasis = toNum(position.costBasis);
      const unrealizedPl = toNum(position.unrealizedPl);
      const assetClass = position.assetClass ? String(position.assetClass) : null;

      const dailyChange =
        currentPrice !== null && lastdayPrice !== null
          ? qty * (currentPrice - lastdayPrice)
          : null;

      return {
        symbol: displaySymbol(String(position.symbol), assetClass),
        // Filled in by the API layer; the broker itself has no company names.
        name: null,
        qty,
        side: position.side ? String(position.side) : null,
        assetClass,
        avgEntryPrice: toNum(position.avgEntryPrice),
        currentPrice,
        lastdayPrice,
        costBasis,
        marketValue: toNum(position.marketValue),
        unrealizedPl,
        unrealizedPlPercent:
          unrealizedPl !== null && costBasis !== null && costBasis !== 0
            ? (unrealizedPl / Math.abs(costBasis)) * 100
            : null,
        dailyChange,
        dailyChangePercent:
          currentPrice !== null && lastdayPrice !== null && lastdayPrice !== 0
            ? ((currentPrice - lastdayPrice) / lastdayPrice) * 100
            : null,
      };
    });
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/* -------------------------------- snapshot -------------------------------- */

/** Everything the dashboard needs, pulled live from Alpaca. */
export async function getPortfolioSnapshot(options?: {
  pendingOrders?: PendingOrder[];
}): Promise<PortfolioSnapshot> {
  const [account, positions] = await Promise.all([
    getAlpacaAccount(),
    getAlpacaPositions(),
  ]);

  const positionsValue = positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
  const costBasis = positions.reduce((sum, p) => sum + (p.costBasis ?? 0), 0);
  const unrealizedPl = positions.reduce((sum, p) => sum + (p.unrealizedPl ?? 0), 0);
  const dailyChange = positions.reduce((sum, p) => sum + (p.dailyChange ?? 0), 0);

  // Alpaca reports tickers only; the holdings table shows "AAPL - Apple Inc.".
  // Resolved here so every consumer of a snapshot (API route and the server
  // render alike) gets names, rather than only the ones that call this route.
  const names = await resolveAssetNames(positions.map((p) => p.symbol));

  return {
    source: "alpaca",
    paper: isPaperTrading(),
    asOf: new Date().toISOString(),
    account,
    positions: positions.map((position) => ({
      ...position,
      name: names[position.symbol.toUpperCase()] ?? nameForSymbol(position.symbol),
    })),
    totals: { positionsValue, costBasis, unrealizedPl, dailyChange },
    pendingOrders: options?.pendingOrders ?? [],
  };
}

/* --------------------------------- orders --------------------------------- */

export type OrderType = "market" | "limit";

export type PlaceOrderInput = {
  symbol: string;
  side: "buy" | "sell";
  /** Share/unit quantity. */
  qty: number;
  type: OrderType;
  /** Required for limit orders. */
  limitPrice?: number;
  /** Optional dollar amount (market buys only). */
  notional?: number;
};

export type PlacedOrder = {
  id: string | null;
  clientOrderId: string | null;
  symbol: string;
  side: "buy" | "sell";
  type: OrderType;
  status: string | null;
  qty: number;
  filledQty: number;
  filledAvgPrice: number;
  /** Submitted dollar amount, when the order was placed by notional. */
  notional: number | null;
  submittedAt: string | null;
  assetClass: "crypto" | "equity";
};

type RawOrder = {
  id?: string | null;
  clientOrderId?: string | null;
  status?: string | null;
  qty?: string | number | null;
  filledQty?: string | number | null;
  filledAvgPrice?: string | number | null;
  notional?: string | number | null;
  submittedAt?: string | Date | null;
};

function mapPlacedOrder(
  order: RawOrder,
  symbol: string,
  side: "buy" | "sell",
  type: OrderType,
): PlacedOrder {
  return {
    id: order.id ?? null,
    clientOrderId: order.clientOrderId ?? null,
    symbol,
    side,
    type,
    status: order.status ?? null,
    qty: toNum(order.qty) ?? 0,
    filledQty: toNum(order.filledQty) ?? 0,
    filledAvgPrice: toNum(order.filledAvgPrice) ?? 0,
    notional: toNum(order.notional),
    submittedAt: order.submittedAt ? String(order.submittedAt) : null,
    assetClass: isCryptoSymbol(symbol) ? "crypto" : "equity",
  };
}

export async function placeAlpacaOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  const client = clientOrThrow();
  const symbol = normalizeAlpacaSymbol(input.symbol);
  const timeInForce = defaultTimeInForce(symbol);

  const usingNotional =
    input.type === "market" &&
    input.notional !== undefined &&
    Number.isFinite(input.notional) &&
    input.notional > 0;

  if (!usingNotional && (!Number.isFinite(input.qty) || input.qty <= 0)) {
    throw new AlpacaError("Quantity must be a positive number.", 400, "INVALID_QTY");
  }

  if (input.type === "limit" && (!input.limitPrice || input.limitPrice <= 0)) {
    throw new AlpacaError(
      "A positive limit price is required for limit orders.",
      400,
      "INVALID_LIMIT_PRICE",
    );
  }

  try {
    const order =
      input.type === "limit"
        ? await client.trading.orders.limit({
            symbol,
            side: input.side,
            qty: String(input.qty),
            limitPrice: String(input.limitPrice),
            timeInForce,
          })
        : usingNotional
          ? await client.trading.orders.market({
              symbol,
              side: input.side,
              notional: (input.notional as number).toFixed(2),
              timeInForce,
            })
          : await client.trading.orders.market({
              symbol,
              side: input.side,
              qty: String(input.qty),
              timeInForce,
            });

    return mapPlacedOrder(order, symbol, input.side, input.type);
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/**
 * Re-read a single order. Market orders are frequently `pending_new` in the
 * submit response and fill a moment later, so callers poll this to capture the
 * real filled quantity and average price.
 */
export async function getAlpacaOrder(orderId: string): Promise<PlacedOrder | null> {
  const client = clientOrThrow();
  try {
    const order = await client.trading.orders.getOrderByOrderID({ orderId });
    const symbol = normalizeAlpacaSymbol(String(order.symbol));
    const side: "buy" | "sell" = order.side === "sell" ? "sell" : "buy";
    const type: OrderType = order.type === "limit" ? "limit" : "market";
    return mapPlacedOrder(order, symbol, side, type);
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/* --------------------------------- history -------------------------------- */

export type AlpacaOrderSummary = {
  id: string | null;
  symbol: string | null;
  side: string | null;
  type: string | null;
  status: string | null;
  qty: number | null;
  notional: number | null;
  limitPrice: number | null;
  filledQty: number | null;
  filledAvgPrice: number | null;
  assetClass: string | null;
  submittedAt: string | null;
};

/** Orders the broker still considers working (accepted, not yet filled). */
export async function getOpenAlpacaOrders(limit = 50): Promise<AlpacaOrderSummary[]> {
  const client = clientOrThrow();
  try {
    const orders = await client.trading.orders.getAllOrders({
      status: "open",
      limit,
      direction: "desc",
    });

    return orders.map((order) => ({
      id: order.id ?? null,
      symbol: order.symbol ?? null,
      side: order.side ? String(order.side) : null,
      type: order.type ? String(order.type) : null,
      status: order.status ?? null,
      qty: toNum(order.qty),
      notional: toNum(order.notional),
      limitPrice: toNum(order.limitPrice),
      filledQty: toNum(order.filledQty),
      filledAvgPrice: toNum(order.filledAvgPrice),
      assetClass: order.assetClass ? String(order.assetClass) : null,
      submittedAt: order.submittedAt ? String(order.submittedAt) : null,
    }));
  } catch (error) {
    throw toAlpacaError(error);
  }
}

export async function getRecentAlpacaOrders(limit = 25): Promise<AlpacaOrderSummary[]> {
  const client = clientOrThrow();
  try {
    const orders = await client.trading.orders.getAllOrders({ limit, direction: "desc" });
    return orders.map((order) => ({
      id: order.id ?? null,
      symbol: order.symbol ?? null,
      side: order.side ? String(order.side) : null,
      type: order.type ? String(order.type) : null,
      status: order.status ?? null,
      qty: toNum(order.qty),
      notional: toNum(order.notional),
      limitPrice: toNum(order.limitPrice),
      filledQty: toNum(order.filledQty),
      filledAvgPrice: toNum(order.filledAvgPrice),
      assetClass: order.assetClass ? String(order.assetClass) : null,
      submittedAt: order.submittedAt ? String(order.submittedAt) : null,
    }));
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/* ----------------------------- market clock ------------------------------- */

export type MarketSession = {
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
};

/**
 * US equity market clock. Crypto is never closed, so callers only consult this
 * for equities.
 */
export async function getMarketClock(): Promise<MarketSession> {
  const client = clientOrThrow();
  try {
    const clock = await client.trading.clock.legacyClock();
    return {
      isOpen: clock.isOpen === true,
      nextOpen: clock.nextOpen ? new Date(clock.nextOpen).toISOString() : null,
      nextClose: clock.nextClose ? new Date(clock.nextClose).toISOString() : null,
    };
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/* ---------------------------- reference price ----------------------------- */

/**
 * A current price for a symbol, used to validate an order before submitting it
 * (and as the limit price when an equity order is queued outside market hours).
 *
 * Equities use the latest trade, falling back to the last daily bar; crypto uses
 * the most recent daily bar close.
 */
export async function getReferencePrice(symbol: string): Promise<number | null> {
  const client = clientOrThrow();
  const normalized = normalizeAlpacaSymbol(symbol);

  try {
    if (isCryptoSymbol(normalized)) {
      return await getCryptoPrice(normalized);
    }

    const latest = await client.marketData.getLatestPrice(normalized);
    if (typeof latest === "number" && Number.isFinite(latest) && latest > 0) {
      return latest;
    }

    const bars = await client.marketData.getStockBarsFor(normalized, {
      timeframe: TimeFrame.Day,
      limit: 1,
      sort: "desc",
    });
    const close = bars.length > 0 ? toNum(bars[0].close) : null;
    return close !== null && close > 0 ? close : null;
  } catch (error) {
    throw toAlpacaError(error);
  }
}

/** Cancel a resting order. Returns true when the broker accepted the cancel. */
export async function cancelAlpacaOrder(orderId: string): Promise<boolean> {
  const client = clientOrThrow();
  try {
    await client.trading.orders.deleteOrderByOrderID({ orderId });
    return true;
  } catch (error) {
    console.warn(`Could not cancel Alpaca order ${orderId}:`, toAlpacaError(error).message);
    return false;
  }
}

/* ----------------------------- crypto pricing ----------------------------- */

/** Latest crypto price, from the most recent daily bar close. */
export async function getCryptoPrice(symbol: string): Promise<number | null> {
  return (await getCryptoQuote(symbol)).price;
}

/** How far back to look for the previous daily bar behind the latest one. */
const CRYPTO_BAR_WINDOW_DAYS = 8;

export type CryptoQuote = {
  /** Most recent daily close, or null when unavailable. */
  price: number | null;
  /** The daily bar before it, i.e. the reference for the 24h move. */
  previousClose: number | null;
  /** Percent change over the last day. */
  changePercent: number | null;
};

/**
 * Latest crypto price plus its 24-hour move.
 *
 * The move is derived from two daily bars rather than a provider's percent
 * field: crypto trades 24/7, so the previous daily bar is exactly the 24-hour
 * reference point.
 *
 * The window is explicit (`start`/`end` as Dates) because asking for `limit: 2`
 * with no window returns only the current, still-forming bar — leaving no
 * previous close to compare against and silently dropping the 24h figure.
 *
 * Never throws for a missing symbol — an unpriceable pair yields nulls so one
 * bad ticker cannot break a whole grid.
 */
export async function getCryptoQuote(symbol: string): Promise<CryptoQuote> {
  const client = clientOrThrow();

  try {
    const bars = await client.marketData.getCryptoBarsFor(
      normalizeAlpacaSymbol(symbol),
      {
        timeframe: TimeFrame.Day,
        start: new Date(Date.now() - CRYPTO_BAR_WINDOW_DAYS * 24 * 60 * 60 * 1000),
        end: new Date(),
        sort: "desc",
        // Alpaca requires a crypto location ("us" for USD pairs).
        loc: "us",
      },
    );

    const price = bars.length > 0 ? toNum(bars[0].close) : null;
    const previousClose = bars.length > 1 ? toNum(bars[1].close) : null;

    const changePercent =
      price !== null && previousClose !== null && previousClose !== 0
        ? ((price - previousClose) / previousClose) * 100
        : null;

    return {
      price: price !== null && price > 0 ? price : null,
      previousClose:
        previousClose !== null && previousClose > 0 ? previousClose : null,
      changePercent,
    };
  } catch (error) {
    console.warn(`Could not price crypto ${symbol}:`, toAlpacaError(error).message);
    return { price: null, previousClose: null, changePercent: null };
  }
}

/* ------------------------------- asset catalog ------------------------------- */

export type AlpacaAsset = {
  id: string;
  symbol: string;
  name: string | null;
  exchange: string | null;
  /** Alpaca's raw asset class: "us_equity", "crypto", "us_option", "forex". */
  assetClass: string | null;
  tradable: boolean;
  fractionable: boolean;
  status: string | null;
};

/**
 * Every asset the broker lists as active.
 *
 * This is a large, slowly-changing reference list (tens of thousands of rows) and
 * the round trip costs seconds, so callers must cache the result rather than
 * hitting it per request.
 *
 * Note that the `asset_class` filter is not honoured by the SDK, so a single call
 * returns every class mixed together — filter on `assetClass` downstream.
 */
export async function getAlpacaAssets(status = "active"): Promise<AlpacaAsset[]> {
  const client = clientOrThrow();

  const raw = (await client.trading.assets.getV2Assets({
    status,
  })) as unknown as Record<string, unknown>[];

  return raw.map((entry) => ({
    id: String(entry.id ?? entry.symbol ?? ""),
    symbol: String(entry.symbol ?? ""),
    name: entry.name ? String(entry.name) : null,
    exchange: entry.exchange ? String(entry.exchange) : null,
    assetClass: entry._class ? String(entry._class) : null,
    tradable: entry.tradable === true,
    fractionable: entry.fractionable === true,
    status: entry.status ? String(entry.status) : null,
  }));
}
