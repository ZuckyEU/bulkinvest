import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getFeaturedQuotes } from "@/lib/featured-assets";

/**
 * GET /api/markets/featured
 *
 * Live pricing for the curated Markets grid (popular equities + featured
 * crypto), so the landing page is populated before anyone searches.
 *
 * Session-scoped because it sits under /markets, which the app protects; it
 * exposes nothing that is not already on the public markets page.
 *
 * 200 { assets, asOf } | 401 | 503
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const assets = await getFeaturedQuotes();

  return NextResponse.json(
    { assets, asOf: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}