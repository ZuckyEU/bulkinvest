import { NextResponse } from "next/server";
import { getQuotes } from "@/lib/stocks";

/**
 * GET /api/stocks/quotes?symbols=AAPL,NVDA
 *
 * Batch quote lookup, so a portfolio can be priced in one request instead of
 * one request per holding.
 *
 * 200 { quotes: [...], errors: [{ symbol, error }] }
 * 400 no symbols / too many symbols
 */
export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 25;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("symbols") ?? "";

  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one symbol, e.g. ?symbols=AAPL,NVDA", code: "NO_SYMBOLS" },
      { status: 400 },
    );
  }

  if (symbols.length > MAX_SYMBOLS) {
    return NextResponse.json(
      {
        error: `Too many symbols. Maximum is ${MAX_SYMBOLS} per request.`,
        code: "TOO_MANY_SYMBOLS",
      },
      { status: 400 },
    );
  }

  try {
    const result = await getQuotes(symbols);

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    console.error("Unexpected error in GET /api/stocks/quotes:", error);
    return NextResponse.json(
      { error: "Unexpected server error.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
