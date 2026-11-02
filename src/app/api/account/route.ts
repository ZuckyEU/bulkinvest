import { NextResponse } from "next/server";
import { getAccountForUser } from "@/lib/account";
import { getSessionUser } from "@/lib/session";
import { getPortfolioSnapshot, isAlpacaConfigured } from "@/lib/alpaca";

/**
 * GET /api/account
 *
 * The signed-in user's trading account. When Alpaca is configured the cash,
 * buying power and positions come straight from Alpaca so the trade ticket
 * cannot offer more than the broker will accept. Otherwise the local paper
 * ledger is used.
 *
 * 200 account | 401 not signed in | 500 unexpected
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

  try {
    const local = await getAccountForUser(user.id);
    if (!local) {
      return NextResponse.json(
        { error: "Your session is no longer valid. Please sign in again.", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }

    if (isAlpacaConfigured()) {
      try {
        const snapshot = await getPortfolioSnapshot();
        return NextResponse.json(
          {
            id: local.id,
            name: local.name,
            email: local.email,
            cashBalance: snapshot.account.cash ?? 0,
            buyingPower: snapshot.account.buyingPower,
            source: "alpaca" as const,
            paper: snapshot.paper,
            holdings: snapshot.positions.map((position) => ({
              symbol: position.symbol,
              name: position.name,
              shares: position.qty,
              avgPrice: position.avgEntryPrice ?? 0,
            })),
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } catch (error) {
        // Fall through to the local ledger rather than failing the whole page.
        console.error("Alpaca account fetch failed; using local ledger:", error);
      }
    }

    return NextResponse.json(
      { ...local, source: "local" as const, paper: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unexpected error in GET /api/account:", error);
    return NextResponse.json(
      { error: "Could not load the account.", code: "ACCOUNT_UNAVAILABLE" },
      { status: 500 },
    );
  }
}
