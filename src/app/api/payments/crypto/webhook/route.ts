import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { creditDeposit } from "@/lib/deposits";
import {
  CREDITED_STATUSES,
  CryptoPaymentError,
  fetchPayment,
  getIpnSecret,
  type IpnPayload,
  PAYMENT_PROVIDER_NOWPAYMENTS,
  verifyIpnSignature,
} from "@/lib/crypto-payments";

/**
 * POST /api/payments/crypto/webhook
 *
 * NOWPayments IPN receiver. Public by necessity (the gateway cannot hold a
 * session) and secured by verifying the `x-nowpayments-sig` HMAC-SHA512 header
 * against CRYPTO_PAYMENT_WEBHOOK_SECRET.
 *
 * On a confirmed/sending/finished status the deposit's USD value is credited to
 * the user's cashBalance and a DEPOSIT row is logged with the on-chain hash.
 * Crediting is idempotent on the provider payment id, so gateway retries and
 * repeated confirmations are safe.
 *
 * 200 handled/ignored | 400 bad signature/body | 503 not configured
 */
export const dynamic = "force-dynamic";

/**
 * How "far along" each gateway status is. Used so an out-of-order or replayed
 * callback cannot walk a deposit backwards (e.g. a stale `waiting` arriving
 * after `confirmed`).
 */
const STATUS_RANK: Record<string, number> = {
  creating: 0,
  waiting: 1,
  confirming: 2,
  partially_paid: 3,
  confirmed: 4,
  sending: 5,
  finished: 6,
  failed: 7,
  refunded: 7,
  expired: 7,
};

export async function POST(request: Request) {
  if (!getIpnSecret()) {
    return NextResponse.json(
      {
        error: "Crypto webhooks are not configured. Set CRYPTO_PAYMENT_WEBHOOK_SECRET.",
        code: "CRYPTO_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  const rawBody = await request.text();

  if (!verifyIpnSignature(rawBody, request.headers.get("x-nowpayments-sig"))) {
    console.warn("Rejected crypto webhook with an invalid signature.");
    return NextResponse.json(
      { error: "Invalid signature.", code: "INVALID_SIGNATURE" },
      { status: 400 },
    );
  }

  let payload: IpnPayload;
  try {
    payload = JSON.parse(rawBody) as IpnPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const paymentId =
    payload.payment_id !== undefined ? String(payload.payment_id) : null;
  const orderId = typeof payload.order_id === "string" ? payload.order_id : null;
  const status = (payload.payment_status ?? "unknown").toLowerCase();

  if (!paymentId && !orderId) {
    return NextResponse.json(
      { error: "Missing payment_id and order_id.", code: "INVALID_PAYLOAD" },
      { status: 400 },
    );
  }

  // Correlate by provider id first, then fall back to our own order id (covers
  // a webhook that arrives before the charge response was persisted).
  const deposit = await prisma.cryptoDeposit.findFirst({
    where: {
      OR: [
        ...(paymentId ? [{ providerId: paymentId }] : []),
        ...(orderId ? [{ orderId }] : []),
      ],
    },
  });

  if (!deposit) {
    console.warn(
      `Crypto webhook for unknown deposit (payment_id=${paymentId}, order_id=${orderId}).`,
    );
    // Acknowledge so the gateway stops retrying an event we cannot match.
    return NextResponse.json({ received: true, ignored: "unknown_deposit" });
  }

  // Prefer the on-chain hash from the payload; otherwise ask the provider.
  let txHash: string | null = payload.payin_hash ?? payload.outcome_hash ?? null;
  if (!txHash) {
    try {
      const remote = await fetchPayment(paymentId ?? deposit.providerId ?? "");
      txHash = remote.txHash;
    } catch (error) {
      if (!(error instanceof CryptoPaymentError)) throw error;
      console.warn("Could not resolve on-chain hash from the gateway:", error.message);
    }
  }

  // Never walk the status backwards, and never un-settle a credited deposit.
  const currentRank = STATUS_RANK[deposit.status] ?? 0;
  const incomingRank = STATUS_RANK[status] ?? 0;
  const shouldAdvanceStatus = !deposit.transactionId && incomingRank >= currentRank;

  await prisma.cryptoDeposit.update({
    where: { id: deposit.id },
    data: {
      providerId: deposit.providerId ?? paymentId,
      ...(shouldAdvanceStatus ? { status } : {}),
      ...(txHash ? { txHash } : {}),
    },
  });

  if (!CREDITED_STATUSES.has(status)) {
    return NextResponse.json({ received: true, status });
  }

  if (deposit.transactionId) {
    // Already credited on an earlier confirmation.
    return NextResponse.json({ received: true, status, credited: false });
  }

  const reference = `nowpayments:${paymentId ?? deposit.providerId}`;

  const result = await creditDeposit({
    userId: deposit.userId,
    amount: deposit.amountUsd,
    currency: "USD",
    provider: PAYMENT_PROVIDER_NOWPAYMENTS,
    reference,
    txHash,
  });

  await prisma.cryptoDeposit.update({
    where: { id: deposit.id },
    data: { transactionId: result.transactionId || undefined },
  });

  return NextResponse.json({
    received: true,
    status,
    credited: result.credited,
    amount: result.amount,
    txHash,
  });
}
