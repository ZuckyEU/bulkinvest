import { parseTradeBody, executeTrade, TradeError, type TradeSide } from "@/lib/trading";
import {
  AlpacaError,
  getAlpacaOrder,
  getMarketClock,
  getReferencePrice,
  isAlpacaConfigured,
  isCryptoSymbol,
  normalizeAlpacaSymbol,
  placeAlpacaOrder,
  toAlpacaError,
  type OrderType,
  type PlacedOrder,
} from "@/lib/alpaca";
import { logAlpacaOrder } from "@/lib/trades";
import { recordOrder } from "@/lib/orders";

/**
 * Shared execution path for /api/trade/buy and /api/trade/sell.
 *
 * With Alpaca configured it is the execution venue: the order is validated
 * against a live quote first, submitted, and then tracked locally. When it is
 * not configured, the local paper ledger handles the trade.
 */

export type TradeOutcome = { status: number; body: unknown };

const FILL_POLL_ATTEMPTS = 4;
const FILL_POLL_DELAY_MS = 1500;

function badRequest(): TradeOutcome {
  return { status: 400, body: { error: "Request body must be valid JSON.", code: "INVALID_JSON" } };
}

function isFilled(order: PlacedOrder): boolean {
  return order.filledQty > 0 || order.status === "filled";
}

/**
 * Market orders come back `pending_new` and fill shortly after. Poll briefly so
 * the response carries the real fill instead of zeros.
 */
async function resolveFill(order: PlacedOrder): Promise<PlacedOrder> {
  if (!order.id || order.filledQty > 0) return order;

  let current = order;
  for (let attempt = 0; attempt < FILL_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, FILL_POLL_DELAY_MS));
    try {
      const fresh = await getAlpacaOrder(current.id as string);
      if (!fresh) continue;
      if (fresh.filledQty > 0) return fresh;
      current = { ...current, status: fresh.status ?? current.status };
    } catch {
      // Keep polling; the order may already be filled.
    }
  }
  return current;
}

type ParsedAlpacaOrder = {
  side: "buy" | "sell";
  symbol: string;
  crypto: boolean;
  qty: number;
  notional?: number;
  requestedType: OrderType;
  limitPrice?: number;
};

function parseAlpacaOrderBody(raw: unknown, side: TradeSide): ParsedAlpacaOrder {
  const body = (raw ?? {}) as Record<string, unknown>;

  const sideLower: "buy" | "sell" = side === "BUY" ? "buy" : "sell";
  const symbol = typeof body.symbol === "string" ? body.symbol : "";

  const qtySource = body.shares ?? body.qty;
  const qty =
    typeof qtySource === "number"
      ? qtySource
      : typeof qtySource === "string"
        ? Number(qtySource)
        : Number.NaN;

  const requestedType: OrderType = body.type === "limit" ? "limit" : "market";

  const limitPrice =
    body.limitPrice !== undefined && body.limitPrice !== null
      ? Number(body.limitPrice)
      : undefined;

  const notional =
    body.notional !== undefined && body.notional !== null
      ? Number(body.notional)
      : undefined;

  return {
    side: sideLower,
    symbol,
    // normalizeAlpacaSymbol throws for junk; callers handle it as a 400.
    crypto: isCryptoSymbol(normalizeAlpacaSymbol(symbol)),
    qty,
    notional,
    requestedType,
    limitPrice,
  };
}

async function runAlpacaTrade(
  raw: unknown,
  side: TradeSide,
  userId: string,
): Promise<TradeOutcome> {
  let parsed: ParsedAlpacaOrder;
  try {
    parsed = parseAlpacaOrderBody(raw, side);
  } catch (error) {
    const alpacaError = error instanceof AlpacaError ? error : toAlpacaError(error);
    return { status: alpacaError.status, body: { error: alpacaError.message, code: alpacaError.code } };
  }

  const { side: orderSide, symbol, crypto, qty, notional, requestedType } = parsed;

  try {
    // 1. Resolve the market session. Crypto never closes.
    const session = crypto
      ? { isOpen: true, nextOpen: null as string | null, nextClose: null as string | null }
      : await getMarketClock();

    // 2. Fetch a real-time reference price BEFORE submitting, so a market order
    //    can never be sent blind (which is what produced $0.00 fills).
    const referencePrice = await getReferencePrice(symbol);
    if (referencePrice === null || !Number.isFinite(referencePrice) || referencePrice <= 0) {
      return {
        status: 400,
        body: {
          error: `Could not fetch a live price for ${symbol}. Please try again shortly.`,
          code: "NO_QUOTE",
        },
      };
    }

    // 3. Decide the order type. A `market` order cannot rest overnight, so when
    //    the equity market is closed we queue it as a limit at the reference
    //    price and tell the user it will execute at the open.
    let type: OrderType = requestedType;
    let limitPrice = parsed.limitPrice;
    let queued = false;

    if (requestedType === "limit") {
      if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0) {
        return {
          status: 400,
          body: {
            error: "A limit order needs a limit price.",
            code: "INVALID_LIMIT_PRICE",
          },
        };
      }
    } else if (!crypto && !session.isOpen) {
      type = "limit";
      limitPrice = referencePrice;
      queued = true;
    }

    // A dollar-denominated market buy only makes sense without a share quantity.
    const useNotional =
      type === "market" &&
      orderSide === "buy" &&
      !Number.isFinite(qty) &&
      notional !== undefined &&
      Number.isFinite(notional) &&
      notional > 0;

    if (!useNotional && (!Number.isFinite(qty) || qty <= 0)) {
      return {
        status: 400,
        body: { error: "Quantity must be a positive number.", code: "INVALID_QTY" },
      };
    }

    // 4. Submit.
    const submitted = await placeAlpacaOrder({
      symbol,
      side: orderSide,
      qty: useNotional ? 0 : qty,
      type,
      limitPrice,
      notional: useNotional ? notional : undefined,
    });

    // 5. Only wait for a fill when it can actually happen (equities outside
    //    hours will not fill, so polling would just add latency).
    const shouldPoll = crypto || session.isOpen;
    const order = shouldPoll ? await resolveFill(submitted) : submitted;

    // 6. Record locally (audit ledger + pending-order tracking).
    await logAlpacaOrder(userId, order, referencePrice);
    await recordOrder(userId, order, {
      referencePrice,
      limitPrice: type === "limit" ? (limitPrice ?? null) : null,
    });

    const stillPending = !isFilled(order) && order.status !== "canceled" && order.status !== "rejected";

    return {
      status: 201,
      body: {
        provider: "alpaca",
        order,
        referencePrice,
        venue: "alpaca",
        // Enriched so the UI can explain what happened.
        queued,
        pending: stillPending,
        marketOpen: session.isOpen,
        nextMarketOpen: session.nextOpen,
        message: queued
          ? `Order queued for market open (${session.nextOpen ? new Date(session.nextOpen).toLocaleString() : "next session"}).`
          : stillPending
            ? "Order accepted and awaiting a fill."
            : undefined,
      },
    };
  } catch (error) {
    const alpacaError = error instanceof AlpacaError ? error : toAlpacaError(error);
    return {
      status: alpacaError.status,
      body: { error: alpacaError.message, code: alpacaError.code },
    };
  }
}

async function runLocalTrade(
  raw: unknown,
  side: TradeSide,
  userId: string,
): Promise<TradeOutcome> {
  try {
    const parsed = parseTradeBody(raw);
    const result = await executeTrade({ ...parsed, userId, side });
    return { status: 201, body: result };
  } catch (error) {
    if (error instanceof TradeError) {
      return { status: error.status, body: { error: error.message, code: error.code } };
    }
    console.error(`Unexpected local ${side} error:`, error);
    return { status: 500, body: { error: "Unexpected server error.", code: "INTERNAL_ERROR" } };
  }
}

export async function runTradeRequest(
  request: Request,
  side: TradeSide,
  userId: string,
): Promise<TradeOutcome> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest();
  }

  return isAlpacaConfigured()
    ? runAlpacaTrade(raw, side, userId)
    : runLocalTrade(raw, side, userId);
}
