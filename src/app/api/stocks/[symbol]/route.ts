import { NextResponse } from "next/server";
import { getStockQuote, StockApiError } from "@/lib/stocks";

/**
 * GET /api/stocks/[symbol]
 *
 * Returns real-time price and basic quote info for a ticker (e.g. AAPL).
 *
 * 200 { symbol, name, price, change, changePercent, open, high, low, ... }
 * 400 invalid symbol
 * 404 symbol has no quote data
 * 429 provider rate limit
 * 500 provider not configured
 * 502/504 upstream failure
 */

// Quotes change constantly, so never statically cache the handler itself.
// Caching is handled per-request in the provider layer (30s revalidate).
export const dynamic = "force-dynamic";

type RouteContext = { params: { symbol: string } };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const quote = await getStockQuote(params.symbol, { revalidateSeconds: 30 });

    return NextResponse.json(
      { ...quote, cachedForSeconds: 30 },
      {
        status: 200,
        headers: {
          // Let browsers/CDN serve a slightly stale quote while revalidating.
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (error) {
    if (error instanceof StockApiError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          symbol: params.symbol?.toUpperCase() ?? null,
        },
        { status: error.status },
      );
    }

    console.error("Unexpected error in GET /api/stocks/[symbol]:", error);
    return NextResponse.json(
      { error: "Unexpected server error.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
