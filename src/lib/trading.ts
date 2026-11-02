import { prisma } from "@/lib/prisma";
import { getStockQuote, StockApiError, normalizeSymbol } from "@/lib/stocks";

export type TradeSide = "BUY" | "SELL";

export class TradeError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "TRADE_ERROR") {
    super(message);
    this.name = "TradeError";
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------- money math ------------------------------- */
/* Prisma maps Float to SQLite REAL, so we round explicitly to avoid the
   floating-point drift that would otherwise accumulate in cashBalance. */

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const roundMoney = (value: number) => round(value, 2);
const roundPrice = (value: number) => round(value, 4);
const roundShares = (value: number) => round(value, 6);

const SHARE_EPSILON = 1e-6;

/* ------------------------------ body parsing ------------------------------ */

export type ParsedTrade = {
  symbol: string;
  shares: number;
};

export function parseTradeBody(raw: unknown): ParsedTrade {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new TradeError("Request body must be a JSON object.", 400, "INVALID_BODY");
  }

  const body = raw as Record<string, unknown>;

  const symbol = normalizeSymbol(
    typeof body.symbol === "string" ? body.symbol : undefined,
  );
  if (!symbol) {
    throw new TradeError(
      "`symbol` must be a valid ticker (1-15 letters, numbers, dots or dashes).",
      400,
      "INVALID_SYMBOL",
    );
  }

  const sharesRaw = body.shares;
  const shares =
    typeof sharesRaw === "number"
      ? sharesRaw
      : typeof sharesRaw === "string"
        ? Number(sharesRaw)
        : Number.NaN;

  if (!Number.isFinite(shares) || shares <= 0) {
    throw new TradeError("`shares` must be a positive number.", 400, "INVALID_SHARES");
  }

  const rounded = roundShares(shares);
  if (rounded <= 0) {
    throw new TradeError("`shares` is too small to trade.", 400, "INVALID_SHARES");
  }

  return { symbol, shares: rounded };
}

/* ------------------------------ price lookup ----------------------------- */

async function resolvePrice(symbol: string): Promise<number> {
  try {
    const quote = await getStockQuote(symbol);
    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      throw new TradeError(
        `Could not determine a valid market price for "${symbol}".`,
        502,
        "INVALID_MARKET_PRICE",
      );
    }
    return quote.price;
  } catch (error) {
    if (error instanceof StockApiError) {
      throw new TradeError(error.message, error.status, error.code);
    }
    throw error;
  }
}

/* -------------------------------- results -------------------------------- */

export type TradeResult = {
  type: TradeSide;
  symbol: string;
  shares: number;
  price: number;
  total: number;
  cashBalance: number;
  holding: {
    id: string;
    symbol: string;
    shares: number;
    avgPrice: number;
  } | null;
  transaction: {
    id: string;
    createdAt: Date;
  };
};

/* ------------------------------ core executor ----------------------------- */

export async function executeTrade(input: {
  userId: string;
  symbol: string;
  shares: number;
  side: TradeSide;
}): Promise<TradeResult> {
  // Price comes from the server, never the client, so a caller cannot
  // execute a trade at a price of their choosing.
  const price = await resolvePrice(input.symbol);
  const total = roundMoney(input.shares * price);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { id: true, cashBalance: true },
    });

    if (!user) {
      throw new TradeError(`User "${input.userId}" was not found.`, 404, "USER_NOT_FOUND");
    }

    if (input.side === "BUY") {
      /* Debit conditionally: the `cashBalance: { gte }` guard means two
         concurrent buys cannot both spend the same cash. */
      const debited = await tx.user.updateMany({
        where: { id: user.id, cashBalance: { gte: total } },
        data: { cashBalance: { decrement: total } },
      });

      if (debited.count === 0) {
        throw new TradeError(
          `Insufficient cash balance. Required $${total.toFixed(2)}, available $${roundMoney(
            user.cashBalance,
          ).toFixed(2)}.`,
          400,
          "INSUFFICIENT_FUNDS",
        );
      }

      const existing = await tx.holding.findUnique({
        where: { userId_symbol: { userId: user.id, symbol: input.symbol } },
      });

      let holding;
      if (existing) {
        // Weighted average cost across the old and new lots.
        const totalShares = roundShares(existing.shares + input.shares);
        const totalCost = existing.shares * existing.avgPrice + input.shares * price;
        const avgPrice = roundPrice(totalCost / totalShares);

        holding = await tx.holding.update({
          where: { id: existing.id },
          data: { shares: totalShares, avgPrice },
        });
      } else {
        holding = await tx.holding.create({
          data: {
            userId: user.id,
            symbol: input.symbol,
            shares: input.shares,
            avgPrice: roundPrice(price),
          },
        });
      }

      const transaction = await tx.transaction.create({
        data: {
          userId: user.id,
          symbol: input.symbol,
          type: "BUY",
          shares: input.shares,
          price,
        },
      });

      const updatedUser = await tx.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { cashBalance: true },
      });

      return {
        type: "BUY" as const,
        symbol: input.symbol,
        shares: input.shares,
        price,
        total,
        cashBalance: roundMoney(updatedUser.cashBalance),
        holding: {
          id: holding.id,
          symbol: holding.symbol,
          shares: holding.shares,
          avgPrice: holding.avgPrice,
        },
        transaction: { id: transaction.id, createdAt: transaction.createdAt },
      };
    }

    /* ---------------------------------- SELL --------------------------------- */
    /* Conditional decrement: refuses to oversell, even under concurrency. */
    const sold = await tx.holding.updateMany({
      where: {
        userId: user.id,
        symbol: input.symbol,
        shares: { gte: input.shares },
      },
      data: { shares: { decrement: input.shares } },
    });

    if (sold.count === 0) {
      const existing = await tx.holding.findUnique({
        where: { userId_symbol: { userId: user.id, symbol: input.symbol } },
      });

      if (!existing) {
        throw new TradeError(
          `No open position in "${input.symbol}" to sell.`,
          400,
          "NO_HOLDING",
        );
      }

      throw new TradeError(
        `Insufficient shares. Tried to sell ${input.shares}, holding ${existing.shares}.`,
        400,
        "INSUFFICIENT_SHARES",
      );
    }

    await tx.user.update({
      where: { id: user.id },
      data: { cashBalance: { increment: total } },
    });

    let holding = await tx.holding.findUnique({
      where: { userId_symbol: { userId: user.id, symbol: input.symbol } },
    });

    // Close the position entirely once it is fully sold. Average cost basis
    // is deliberately left unchanged on partial sells.
    if (holding && holding.shares <= SHARE_EPSILON) {
      await tx.holding.delete({ where: { id: holding.id } });
      holding = null;
    }

    const transaction = await tx.transaction.create({
      data: {
        userId: user.id,
        symbol: input.symbol,
        type: "SELL",
        shares: input.shares,
        price,
      },
    });

    const updatedUser = await tx.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { cashBalance: true },
    });

    return {
      type: "SELL" as const,
      symbol: input.symbol,
      shares: input.shares,
      price,
      total,
      cashBalance: roundMoney(updatedUser.cashBalance),
      holding: holding
        ? {
            id: holding.id,
            symbol: holding.symbol,
            shares: holding.shares,
            avgPrice: holding.avgPrice,
          }
        : null,
      transaction: { id: transaction.id, createdAt: transaction.createdAt },
    };
  });
}

/* ------------------------------ route helper ------------------------------ */

export async function runTrade(
  request: Request,
  side: TradeSide,
  userId: string,
): Promise<{ status: number; body: unknown }> {
  try {
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      throw new TradeError("Request body must be valid JSON.", 400, "INVALID_JSON");
    }

    const parsed = parseTradeBody(raw);
    // `userId` comes from the authenticated session, never from the request
    // body, so a caller cannot trade against someone else's account.
    const result = await executeTrade({ ...parsed, userId, side });

    return { status: 201, body: result };
  } catch (error) {
    if (error instanceof TradeError) {
      return {
        status: error.status,
        body: { error: error.message, code: error.code },
      };
    }

    console.error(`Unexpected error in ${side} trade:`, error);
    return {
      status: 500,
      body: { error: "Unexpected server error.", code: "INTERNAL_ERROR" },
    };
  }
}
