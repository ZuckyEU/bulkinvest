import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  createCheckoutSession,
  getDepositCurrency,
  getStripeClient,
  isStripeError,
  resolveOrigin,
} from "@/lib/payments";
import { DepositError, parseDepositAmount } from "@/lib/deposits";

/**
 * POST /api/payments/checkout
 *
 * Body: { amount: number }
 *
 * Starts a card funding flow for the signed-in user and returns a Stripe
 * Checkout URL. The balance is only credited by the signed webhook, never by
 * the browser redirect.
 *
 * Crypto deposits use /api/payments/crypto/create-charge instead.
 *
 * 200 { mode: "stripe", url } | 400 invalid amount | 401 not signed in
 * 503 not configured | 502 provider error
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in to add funds.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  try {
    const amount = parseDepositAmount(
      (raw as Record<string, unknown> | null)?.amount,
    );

    if (!getStripeClient()) {
      return NextResponse.json(
        {
          error:
            "Card payments are not configured. Set STRIPE_SECRET_KEY, or fund with crypto instead.",
          code: "PAYMENTS_NOT_CONFIGURED",
        },
        { status: 503 },
      );
    }

    const currency = getDepositCurrency();

    const session = await createCheckoutSession({
      userId: user.id,
      amount,
      currency,
      origin: resolveOrigin(request),
    });

    return NextResponse.json({
      mode: "stripe",
      url: session.url,
      reference: session.reference,
      amount,
      currency,
    });
  } catch (error) {
    if (error instanceof DepositError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    if (isStripeError(error)) {
      console.error("Stripe rejected the checkout request:", error);
      return NextResponse.json(
        {
          error:
            "The payment provider rejected the request. Check that STRIPE_SECRET_KEY is a valid test/live key.",
          code: "PAYMENT_PROVIDER_ERROR",
        },
        { status: 502 },
      );
    }

    console.error("Unexpected error in POST /api/payments/checkout:", error);
    return NextResponse.json(
      { error: "Could not start the payment.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
