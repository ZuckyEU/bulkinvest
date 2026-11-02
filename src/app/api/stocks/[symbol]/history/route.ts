import { NextResponse } from "next/server";
import { getPriceHistory, StockApiError } from "@/lib/stocks";

/**
 * GET /api/stocks/[symbol]/history?range=1Y
 *
 * Historical OHLC candles for the price chart.
 *
 * Served by Yahoo Finance's chart endpoint rather than Finnhub, because
 * Finnhub's stock/candle route returns 403 on the free plan.
 *
 * range: 1D | 5D | 1M | 3M | 6M | 1Y | 5Y | MAX   (defaults to 1Y)
 *
 * 200 { symbol, currency, range, interval, points, latestPrice, rangeChange, ... }
 * 400 invalid symbol | 404 no history | 429/502/504 upstream failure
 */
export const dynamic = "force-dynamic";

type RouteContext = { params: { symbol: string } };

export async function GET(request: Request, { params }: RouteContext) {
  const range = new URL(request.url).searchParams.get("range");

  try {
    const history = await getPriceHistory(params.symbol, range);

    return NextResponse.json(history, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    if (error instanceof StockApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code, symbol: params.symbol?.toUpperCase() ?? null },
        { status: error.status },
      );
    }

    console.error("Unexpected error in GET /api/stocks/[symbol]/history:", error);
    return NextResponse.json(
      { error: "Unexpected server error.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
