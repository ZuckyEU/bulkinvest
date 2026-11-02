import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { runTradeRequest } from "@/lib/trade-exec";
import { isAlpacaConfigured, isPaperTrading } from "@/lib/alpaca";

/**
 * POST /api/trade/sell
 *
 * Body: { symbol: string, shares: number, type?: "market"|"limit", limitPrice?: number }
 *
 * With ALPACA_API_KEY configured the order is submitted to Alpaca (equities and
 * crypto pairs alike) and Alpaca becomes the source of truth for the resulting
 * position and cash. Without keys it falls back to the local paper ledger.
 *
 * 201 submitted | 400 invalid/rejected | 401 not signed in | 502/504 provider
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in to place a trade.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const { status, body } = await runTradeRequest(request, "SELL", user.id);

  return NextResponse.json(
    { ...(typeof body === "object" && body !== null ? body : { body }), venue: isAlpacaConfigured() ? "alpaca" : "local", paper: isAlpacaConfigured() ? isPaperTrading() : true },
    { status },
  );
}
