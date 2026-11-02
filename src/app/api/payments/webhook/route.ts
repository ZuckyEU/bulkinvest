import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/payments";

/**
 * POST /api/payments/webhook
 *
 * Stripe webhook receiver. This endpoint is intentionally **public** (Stripe
 * cannot authenticate as a user) and is secured by verifying the
 * `stripe-signature` header against STRIPE_WEBHOOK_SECRET.
 *
 * On `checkout.session.completed` (with payment_status=paid) the exact paid
 * amount is credited to the user's cashBalance and a DEPOSIT row is logged.
 * Crediting is idempotent on the Checkout Session id.
 *
 * Local testing:
 *   stripe listen --forward-to localhost:3000/api/payments/webhook
 *
 * 200 handled/ignored | 400 bad signature | 503 not configured
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const { status, body } = await handleStripeWebhook(request);
    return NextResponse.json(body, { status });
  } catch (error) {
    console.error("Unexpected error in POST /api/payments/webhook:", error);
    // 500 tells Stripe to retry; crediting is idempotent so that is safe.
    return NextResponse.json(
      { error: "Could not process the webhook.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
