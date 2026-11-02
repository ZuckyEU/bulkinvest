import Stripe from "stripe";
import {
  creditDeposit,
  DepositError,
  DEFAULT_CURRENCY,
  PAYMENT_PROVIDER_STRIPE,
  parseCurrency,
} from "@/lib/deposits";

/**
 * Stripe (test mode) integration.
 *
 * Checkout is created server-side and the balance is only ever credited from
 * the signed webhook — never from the browser redirect, which a user could
 * fake by simply visiting the success URL.
 */

export function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

/** True for any error raised by the Stripe SDK (bad key, API failure, ...). */
export function isStripeError(error: unknown): boolean {
  return error instanceof Stripe.errors.StripeError;
}

/** Charge currency, driven by the provider account (e.g. USD or NGN). */
export function getDepositCurrency(): string {
  return parseCurrency(process.env.DEPOSIT_CURRENCY?.trim() || DEFAULT_CURRENCY);
}

/* ------------------------------- minor units ------------------------------ */

/**
 * Stripe expects amounts in the currency's smallest unit, but a handful of
 * currencies have no minor unit at all.
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

function toMinorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())
    ? Math.round(amount)
    : Math.round(amount * 100);
}

function fromMinorUnits(amountMinor: number, currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())
    ? amountMinor
    : amountMinor / 100;
}

/* -------------------------------- checkout -------------------------------- */

/** Prefer an explicitly configured public origin over request headers. */
export function resolveOrigin(request: Request): string {
  const configured =
    process.env.NEXTAUTH_URL?.trim() || process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const origin = request.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function createCheckoutSession(input: {
  userId: string;
  amount: number;
  currency: string;
  origin: string;
}): Promise<{ url: string; reference: string }> {
  const stripe = getStripeClient();
  if (!stripe) {
    throw new DepositError(
      "Card payments are not configured.",
      503,
      "PAYMENTS_NOT_CONFIGURED",
    );
  }

  const currency = input.currency.toLowerCase();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency,
          unit_amount: toMinorUnits(input.amount, currency),
          product_data: {
            name: "BulkInvest account deposit",
            description: "Adds virtual funds to your paper-trading balance.",
          },
        },
      },
    ],
    success_url: `${input.origin}/dashboard?deposit=success`,
    cancel_url: `${input.origin}/dashboard?deposit=cancelled`,
    // Ties the payment back to our user so the webhook knows who to credit.
    client_reference_id: input.userId,
    metadata: { userId: input.userId, currency: input.currency.toUpperCase() },
  });

  if (!session.url) {
    throw new DepositError(
      "Stripe did not return a checkout URL.",
      502,
      "CHECKOUT_FAILED",
    );
  }

  return { url: session.url, reference: session.id };
}

/* --------------------------------- webhook -------------------------------- */

export type WebhookOutcome = {
  status: number;
  body: Record<string, unknown>;
};

/**
 * Verify and process a Stripe webhook.
 *
 * Returns 2xx for events we deliberately ignore, so Stripe stops retrying, and
 * non-2xx only when we genuinely failed to process a payment (Stripe will then
 * retry, and idempotency makes that safe).
 */
export async function handleStripeWebhook(
  request: Request,
): Promise<WebhookOutcome> {
  const stripe = getStripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!stripe || !secret) {
    return {
      status: 503,
      body: {
        error: "Stripe webhooks are not configured.",
        code: "PAYMENTS_NOT_CONFIGURED",
      },
    };
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return {
      status: 400,
      body: { error: "Missing stripe-signature header.", code: "MISSING_SIGNATURE" },
    };
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.warn("Rejected Stripe webhook with a bad signature:", error);
    return {
      status: 400,
      body: { error: "Invalid signature.", code: "INVALID_SIGNATURE" },
    };
  }

  if (event.type !== "checkout.session.completed") {
    return { status: 200, body: { received: true, ignored: event.type } };
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // `completed` fires even for delayed methods; only credit settled payments.
  if (session.payment_status !== "paid") {
    return {
      status: 200,
      body: { received: true, ignored: `payment_status=${session.payment_status}` },
    };
  }

  const userId = session.client_reference_id ?? session.metadata?.userId ?? null;
  if (!userId) {
    console.error("Stripe session had no user reference:", session.id);
    return {
      status: 200,
      body: { received: true, ignored: "missing_user_reference" },
    };
  }

  const currency = (session.currency ?? getDepositCurrency()).toUpperCase();
  const amount = fromMinorUnits(session.amount_total ?? 0, currency);

  try {
    const result = await creditDeposit({
      userId,
      amount,
      currency,
      provider: PAYMENT_PROVIDER_STRIPE,
      // The Checkout Session id is our idempotency key.
      reference: session.id,
    });

    return {
      status: 200,
      body: {
        received: true,
        credited: result.credited,
        amount: result.amount,
        currency: result.currency,
      },
    };
  } catch (error) {
    // A reference already credited to a different account is a data-integrity
    // problem that retrying cannot fix, so acknowledge and log it.
    if (error instanceof DepositError && error.code === "REFERENCE_CONFLICT") {
      console.error(
        `Stripe reference ${session.id} is already credited to another account; ignoring.`,
      );
      return { status: 200, body: { received: true, ignored: "reference_conflict" } };
    }
    throw error;
  }
}
