import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getDepositCurrency, getStripeClient } from "@/lib/payments";
import { MAX_DEPOSIT, MIN_DEPOSIT } from "@/lib/deposits";
import {
  getAssetsWithMinimums,
  isCryptoDepositsConfigured,
} from "@/lib/crypto-payments";

/**
 * GET /api/payments/config
 *
 * Tells the deposit UI which funding paths are available and what limits
 * apply, so the modal does not have to guess. Crypto assets carry the
 * gateway's live per-asset minimum.
 *
 * 200 { card, crypto, currency, minDeposit, maxDeposit } | 401 not signed in
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

  const cryptoEnabled = isCryptoDepositsConfigured();

  return NextResponse.json(
    {
      card: { enabled: getStripeClient() !== null },
      crypto: {
        enabled: cryptoEnabled,
        // Only pay for the extra lookups when the path is actually usable.
        assets: cryptoEnabled ? await getAssetsWithMinimums() : [],
      },
      currency: getDepositCurrency(),
      minDeposit: MIN_DEPOSIT,
      maxDeposit: MAX_DEPOSIT,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
