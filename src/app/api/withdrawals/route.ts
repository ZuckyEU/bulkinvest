import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getAccountForUser } from "@/lib/account";
import {
  createWithdrawalRequest,
  getWithdrawalRequests,
  WithdrawalError,
  MIN_WITHDRAWAL_USD,
  MAX_WITHDRAWAL_USD,
} from "@/lib/withdrawals";

/**
 * /api/withdrawals
 *
 * GET  -> the signed-in user's withdrawal requests, newest first.
 * POST -> record a new withdrawal request with status PENDING.
 *
 * This records intent only. It performs no payout, calls no broker and debits
 * no balance, which is why it is a plain authenticated POST rather than a
 * signed webhook: there is no external party to verify.
 *
 * 200 { requests } | 201 { request } | 400 | 401 | 500
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
    const requests = await getWithdrawalRequests(user.id);
    return NextResponse.json(
      { requests, limits: { min: MIN_WITHDRAWAL_USD, max: MAX_WITHDRAWAL_USD } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unexpected error in GET /api/withdrawals:", error);
    return NextResponse.json(
      { error: "Could not load withdrawal requests.", code: "WITHDRAWAL_UNAVAILABLE" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  let body: { asset?: unknown; amountUsd?: unknown; address?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Send a JSON body with asset, amountUsd and address.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  try {
    // A valid session can outlive a deleted account; do not log a ghost request.
    const account = await getAccountForUser(user.id);
    if (!account) {
      return NextResponse.json(
        { error: "Your session is no longer valid. Please sign in again.", code: "UNAUTHENTICATED" },
        { status: 401 },
      );
    }

    const created = await createWithdrawalRequest({
      userId: user.id,
      asset: typeof body.asset === "string" ? body.asset : "",
      amountUsd: body.amountUsd as number,
      address: typeof body.address === "string" ? body.address : "",
    });

    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    if (error instanceof WithdrawalError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("Unexpected error in POST /api/withdrawals:", error);
    return NextResponse.json(
      { error: "Could not submit the withdrawal request.", code: "WITHDRAWAL_FAILED" },
      { status: 500 },
    );
  }
}