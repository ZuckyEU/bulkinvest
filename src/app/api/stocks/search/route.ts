import { NextResponse } from "next/server";
import { searchSymbols, StockApiError } from "@/lib/stocks";

/**
 * GET /api/stocks/search?q=app
 *
 * Ticker autocomplete backed by Finnhub's /search endpoint
 * (Alpha Vantage SYMBOL_SEARCH is used when only that key is configured).
 *
 * 200 { query, results: [{ symbol, name, type }] }
 * 400 query too long | 500 provider not configured | 502/504 upstream failure
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";

  try {
    const results = await searchSymbols(query, { limit: 10 });

    return NextResponse.json(
      { query: query.trim(), results },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (error) {
    if (error instanceof StockApiError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("Unexpected error in GET /api/stocks/search:", error);
    return NextResponse.json(
      { error: "Unexpected server error.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
