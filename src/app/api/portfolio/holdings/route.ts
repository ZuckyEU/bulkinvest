import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getAccountForUser } from "@/lib/account";
import { getAlpacaPositions, isAlpacaConfigured } from "@/lib/alpaca";
import { getPendingOrderDTOs } from "@/lib/orders";
import { nameForSymbol, resolveAssetNames } from "@/lib/asset-names";

/**
 * GET /api/portfolio/holdings
 *
 * Open positions plus any orders that are accepted but not yet filled.
 *
 * Position data comes from Alpaca. When Alpaca reports no positions, the
 * response falls back to the locally-recorded pending orders so a user whose
 * order is queued (e.g. equities placed outside market hours) can still see that
 * something is working, instead of an empty table.
 *
 * 200 { source, positions, pendingOrders, ... } | 401 | 502 | 503
 */
export const dynamic = "force-dynamic";

type HoldingRow = {
  symbol: string;
  /** Human-readable asset name, e.g. "Apple Inc." (null when unknown). */
  name: string | null;
  shares: number;
  avgPrice: number;
  currentPrice: number | null;
  marketValue: number;
  unrealizedPl: number | null;
  unrealizedPlPercent: number | null;
  dailyChange: number | null;
  dailyChangePercent: number | null;
  assetClass: string | null;
};

/**
 * Total value on stake: shares x live price.
 *
 * Derived here rather than trusted from the payload so a position that arrives
 * without a market value (or with a stale one) still reports the figure the
 * table shows, using the last known price when the broker has none.
 */
function computeStake(row: {
  shares: number;
  currentPrice: number | null;
  avgPrice: number;
  marketValue: number;
}): { currentPrice: number; marketValue: number; hasLiveQuote: boolean } {
  const hasLiveQuote =
    typeof row.currentPrice === "number" &&
    Number.isFinite(row.currentPrice) &&
    row.currentPrice > 0;

  const currentPrice = hasLiveQuote ? (row.currentPrice as number) : row.avgPrice;
  const marketValue =
    row.marketValue > 0 ? row.marketValue : row.shares * currentPrice;

  return { currentPrice, marketValue, hasLiveQuote };
}

/**
 * Attach a display name to every row.
 *
 * Falls back to the ticker itself rather than leaving a blank cell, so a symbol
 * the quote provider cannot name still reads sensibly in the table.
 */
async function withNames(rows: HoldingRow[]): Promise<HoldingRow[]> {
  const names = await resolveAssetNames(rows.map((row) => row.symbol));

  return rows.map((row) => ({
    ...row,
    name: row.name ?? names[row.symbol.toUpperCase()] ?? nameForSymbol(row.symbol),
  }));
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const pendingOrders = await getPendingOrderDTOs(user.id);

  if (!isAlpacaConfigured()) {
    // Local paper ledger fallback.
    const account = await getAccountForUser(user.id);
    const rows: HoldingRow[] = (account?.holdings ?? []).map((holding) => ({
      symbol: holding.symbol,
      name: null,
      shares: holding.shares,
      avgPrice: holding.avgPrice,
      currentPrice: null,
      marketValue: holding.shares * holding.avgPrice,
      unrealizedPl: 0,
      unrealizedPlPercent: 0,
      dailyChange: null,
      dailyChangePercent: null,
      assetClass: "stock",
    }));

    const positions = await withNames(rows);

    return NextResponse.json(
      {
        source: "local",
        fallbackUsed: positions.length === 0 && pendingOrders.length > 0,
        positions,
        pendingOrders,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const alpacaPositions = await getAlpacaPositions();

    const rows: HoldingRow[] = alpacaPositions.map((position) => {
      const stake = computeStake({
        shares: position.qty,
        currentPrice: position.currentPrice,
        avgPrice: position.avgEntryPrice ?? 0,
        marketValue: position.marketValue ?? 0,
      });

      return {
        symbol: position.symbol,
        name: null,
        shares: position.qty,
        avgPrice: position.avgEntryPrice ?? 0,
        currentPrice: stake.hasLiveQuote ? position.currentPrice : null,
        marketValue: stake.marketValue,
        // Alpaca's P/L is authoritative, but fall back to the derived figure so
        // an incomplete payload still shows a correct gain/loss.
        unrealizedPl: position.unrealizedPl ?? stake.marketValue - position.qty * (position.avgEntryPrice ?? 0),
        unrealizedPlPercent: position.unrealizedPlPercent ?? null,
        dailyChange: position.dailyChange,
        dailyChangePercent: position.dailyChangePercent,
        assetClass: position.assetClass,
      };
    });

    const positions = await withNames(rows);

    // The fallback that matters: no broker positions, but orders are working.
    const fallbackUsed = positions.length === 0 && pendingOrders.length > 0;

    return NextResponse.json(
      {
        source: fallbackUsed ? "local-pending" : "alpaca",
        fallbackUsed,
        positions,
        pendingOrders,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error && typeof error === "object" && "status" in error
        ? Number((error as { status?: number }).status) || 502
        : 502;
    const message = error instanceof Error ? error.message : "Could not load holdings.";
    console.error("Unexpected error in GET /api/portfolio/holdings:", error);
    return NextResponse.json({ error: message, code: "ALPACA_ERROR" }, { status });
  }
}
