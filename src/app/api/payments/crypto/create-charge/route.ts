import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";
import { DepositError, parseDepositAmount } from "@/lib/deposits";
import {
  CRYPTO_ASSETS,
  createCharge,
  CryptoPaymentError,
  findAsset,
  getMinUsdAmount,
  isCryptoDepositsConfigured,
  PAYMENT_PROVIDER_NOWPAYMENTS,
} from "@/lib/crypto-payments";
import { resolveOrigin } from "@/lib/payments";

/**
 * POST /api/payments/crypto/create-charge
 *
 * Body: { asset: "USDT" | "BTC" | "ETH", amount: number }
 *
 * Creates a crypto deposit invoice with the gateway and returns the wallet
 * address, the exact crypto amount due, and a QR code. The balance is NOT
 * credited here — only the signed webhook credits it, once confirmations land.
 *
 * 201 { depositId, asset, network, payAddress, payAmount, qrDataUrl, ... }
 * 400 invalid asset/amount | 401 not signed in | 502/503/504 provider issues
 */
export const dynamic = "force-dynamic";

export async function GET() {
  // Lets the UI render the asset picker without hardcoding it.
  return NextResponse.json(
    { configured: isCryptoDepositsConfigured(), assets: CRYPTO_ASSETS },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in to add funds.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  let raw: Record<string, unknown> | null = null;
  try {
    raw = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const assetDef = findAsset(typeof raw?.asset === "string" ? raw.asset : "");

  if (!assetDef) {
    return NextResponse.json(
      {
        error: `Unsupported asset. Choose one of: ${CRYPTO_ASSETS.map((a) => a.asset).join(", ")}.`,
        code: "INVALID_ASSET",
      },
      { status: 400 },
    );
  }

  if (!isCryptoDepositsConfigured()) {
    return NextResponse.json(
      {
        error:
          "Crypto deposits are not configured. Set CRYPTO_PAYMENT_API_KEY and CRYPTO_PAYMENT_WEBHOOK_SECRET.",
        code: "CRYPTO_NOT_CONFIGURED",
      },
      { status: 503 },
    );
  }

  let amountUsd: number;
  try {
    amountUsd = parseDepositAmount(raw?.amount);
  } catch (error) {
    if (error instanceof DepositError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }
    throw error;
  }

  // The gateway has a per-asset fiat minimum that moves; check it before
  // creating an invoice so the user gets a clear message, not a provider error.
  const minUsd = await getMinUsdAmount(assetDef.payCurrency);
  if (minUsd !== null && amountUsd < minUsd) {
    return NextResponse.json(
      {
        error: `The minimum deposit for ${assetDef.asset} (${assetDef.network}) is about $${Math.ceil(minUsd)}.`,
        code: "AMOUNT_TOO_SMALL",
        minDepositUsd: Math.ceil(minUsd),
      },
      { status: 400 },
    );
  }

  const orderId = `bi_${randomUUID()}`;

  // Persist a draft first so an early webhook can still be correlated by
  // order id, even if it beats the provider response back to us.
  const draft = await prisma.cryptoDeposit.create({
    data: {
      userId: user.id,
      provider: PAYMENT_PROVIDER_NOWPAYMENTS,
      orderId,
      asset: assetDef.asset,
      payCurrency: assetDef.payCurrency,
      amountUsd,
      status: "creating",
    },
    select: { id: true },
  });

  try {
    const charge = await createCharge({
      userId: user.id,
      asset: assetDef,
      amountUsd,
      orderId,
      ipnCallbackUrl: `${resolveOrigin(request)}/api/payments/crypto/webhook`,
    });

    await prisma.cryptoDeposit.update({
      where: { id: draft.id },
      data: {
        providerId: charge.providerId,
        payAddress: charge.payAddress,
        payAmount: charge.payAmount,
        network: charge.network,
        status: charge.status,
      },
    });

    return NextResponse.json(
      {
        depositId: draft.id,
        asset: assetDef.asset,
        name: assetDef.name,
        network: charge.network ?? assetDef.network,
        payCurrency: charge.payCurrency,
        amountUsd: charge.priceAmount,
        priceCurrency: charge.priceCurrency,
        payAddress: charge.payAddress,
        payAmount: charge.payAmount,
        paymentUri: charge.paymentUri,
        qrDataUrl: charge.qrDataUrl,
        status: charge.status,
      },
      { status: 201 },
    );
  } catch (error) {
    await prisma.cryptoDeposit
      .update({ where: { id: draft.id }, data: { status: "failed" } })
      .catch(() => undefined);

    if (error instanceof CryptoPaymentError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error(
      "Unexpected error in POST /api/payments/crypto/create-charge:",
      error,
    );
    return NextResponse.json(
      { error: "Could not create the crypto deposit.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
