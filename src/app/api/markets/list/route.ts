import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  CatalogError,
  getCatalogPage,
  parsePageParams,
} from "@/lib/market-catalog";

/**
 * GET /api/markets/list?page=1&limit=12&q=apple
 *
 * One page of the tradable-asset catalog, backed by Alpaca's active-asset
 * list. Supports an optional `q` that filters the *whole* catalog by ticker or
 * company name before paginating, so search covers all ~6k instruments rather
 * than just the page on screen.
 *
 * Session-scoped because /markets is behind auth.
 *
 * 200 { items, page, limit, total, totalPages, hasMore, query } | 400 | 401
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);

  try {
    const { page, limit, query } = parsePageParams({
      page: url.searchParams.get("page"),
      limit: url.searchParams.get("limit"),
      q: url.searchParams.get("q"),
    });

    const result = await getCatalogPage({ page, limit, query });

    return NextResponse.json(result, {
      headers: {
        // Prices are not included here, but the asset list itself is stable;
        // a short shared-cache window absorbs rapid paging.
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (error) {
    if (error instanceof CatalogError) {
      return NextResponse.json(
        { error: error.message, code: "BAD_REQUEST" },
        { status: 400 },
      );
    }
    console.error("Could not page the asset catalog:", error);
    return NextResponse.json(
      { error: "Could not load the market catalog.", code: "CATALOG_ERROR" },
      { status: 502 },
    );
  }
}