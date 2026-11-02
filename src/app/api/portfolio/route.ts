import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getPortfolioSnapshot, isAlpacaConfigured } from "@/lib/alpaca";
import { getPendingOrderDTOs } from "@/lib/orders";

/**
 * GET /api/portfolio
 *
 * Live portfolio straight from Alpaca: cash, buying power, equity, positions and
 * any locally-tracked orders that are still unfilled.
 *
 * 200 snapshot | 401 not signed in | 502 Alpaca error | 503 not configured
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

  if (!isAlpacaConfigured()) {
    return NextResponse.json(
      {
        error:
          "Alpaca is not configured. Set ALPACA_API_KEY and ALPACA_SECRET_KEY.",
        code: "ALPACA_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  try {
    // Queued/working orders live locally, so they are merged into the snapshot.
    const pendingOrders = await getPendingOrderDTOs(user.id);
    const snapshot = await getPortfolioSnapshot({ pendingOrders });

    return NextResponse.json(snapshot, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status) || 502
        : 502;
    const message = error instanceof Error ? error.message : "Could not load the portfolio.";
    console.error("Unexpected error in GET /api/portfolio:", error);
    return NextResponse.json({ error: message, code: "ALPACA_ERROR" }, { status });
  }
}
