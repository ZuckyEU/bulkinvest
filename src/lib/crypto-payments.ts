import { createHmac, timingSafeEqual } from "node:crypto";
import { toDataURL } from "qrcode";
import { DEFAULT_CURRENCY, MIN_DEPOSIT } from "@/lib/deposits";

/**
 * NOWPayments integration (crypto deposits).
 *
 * Flow:
 *   1. POST /api/payments/crypto/create-charge -> POST /v1/payment
 *      returns a wallet address + the exact crypto amount to send.
 *   2. The user sends funds; NOWPayments calls our IPN webhook as the transfer
 *      gains confirmations.
 *   3. /api/payments/crypto/webhook verifies the HMAC signature and credits the
 *      account once, keyed on the provider payment id.
 *
 * Set CRYPTO_PAYMENT_SANDBOX="true" to use the sandbox host.
 */

export const PAYMENT_PROVIDER_NOWPAYMENTS = "nowpayments";

const LIVE_BASE = "https://api.nowpayments.io/v1";
const SANDBOX_BASE = "https://api-sandbox.nowpayments.io/v1";

const REQUEST_TIMEOUT_MS = 15_000;

/** Assets offered in the deposit modal. */
export type CryptoAsset = {
  /** Ticker shown to the user. */
  asset: string;
  /** NOWPayments `pay_currency` code. */
  payCurrency: string;
  /** Human-readable network. */
  network: string;
  name: string;
};

export const CRYPTO_ASSETS: readonly CryptoAsset[] = [
  { asset: "USDT", payCurrency: "usdttrc20", network: "TRON (TRC20)", name: "Tether USD" },
  { asset: "BTC", payCurrency: "btc", network: "Bitcoin", name: "Bitcoin" },
  { asset: "ETH", payCurrency: "eth", network: "Ethereum (ERC20)", name: "Ethereum" },
] as const;

export function findAsset(asset: string): CryptoAsset | null {
  const upper = asset.trim().toUpperCase();
  return CRYPTO_ASSETS.find((entry) => entry.asset === upper) ?? null;
}

/* ------------------------------ minimums ---------------------------------- */

/**
 * The gateway enforces a fiat minimum per asset (currently ~$18.56 for all of
 * ours). It is not fixed, so we ask the provider and cache the answer.
 */
const MIN_CACHE_MS = 10 * 60 * 1000;
const minCache = new Map<string, { value: number; at: number }>();

export async function getMinUsdAmount(payCurrency: string): Promise<number | null> {
  const cached = minCache.get(payCurrency);
  if (cached && Date.now() - cached.at < MIN_CACHE_MS) return cached.value;

  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const url =
      `${getBaseUrl()}/min-amount?currency_from=usd` +
      `&currency_to=${encodeURIComponent(payCurrency)}&fiat_equivalent=usd`;
    const response = await fetch(url, {
      headers: { "x-api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { min_amount?: number | string };
    const value = Number(payload.min_amount);
    if (!Number.isFinite(value) || value <= 0) return null;

    minCache.set(payCurrency, { value, at: Date.now() });
    return value;
  } catch {
    return null;
  }
}

/** Assets enriched with their live minimum, rounded up to a whole dollar. */
export async function getAssetsWithMinimums() {
  return Promise.all(
    CRYPTO_ASSETS.map(async (entry) => {
      const live = await getMinUsdAmount(entry.payCurrency);
      // Round UP so the form never offers an amount the gateway will reject.
      // 20 is above the provider's current ~18.56 floor if the lookup fails.
      return {
        ...entry,
        minDepositUsd: Math.max(MIN_DEPOSIT, Math.ceil(live ?? 20)),
      };
    }),
  );
}

export class CryptoPaymentError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "CRYPTO_PAYMENT_ERROR") {
    super(message);
    this.name = "CryptoPaymentError";
    this.status = status;
    this.code = code;
  }
}

/* -------------------------------- config ---------------------------------- */

export function getApiKey(): string | null {
  return (
    process.env.CRYPTO_PAYMENT_API_KEY?.trim() ||
    process.env.NOWPAYMENTS_API_KEY?.trim() ||
    null
  );
}

export function getIpnSecret(): string | null {
  return (
    process.env.CRYPTO_PAYMENT_WEBHOOK_SECRET?.trim() ||
    process.env.NOWPAYMENTS_IPN_SECRET?.trim() ||
    null
  );
}

function isSandbox(): boolean {
  return (
    process.env.CRYPTO_PAYMENT_SANDBOX?.trim().toLowerCase() === "true" ||
    process.env.NOWPAYMENTS_SANDBOX?.trim().toLowerCase() === "true"
  );
}

function getBaseUrl(): string {
  return isSandbox() ? SANDBOX_BASE : LIVE_BASE;
}

/** True when the gateway is configured well enough to create a charge. */
export function isCryptoDepositsConfigured(): boolean {
  return getApiKey() !== null;
}

/* --------------------------------- types ---------------------------------- */

type ProviderPayment = {
  payment_id?: string | number;
  payment_status?: string;
  pay_address?: string;
  pay_amount?: number | string;
  price_amount?: number | string;
  price_currency?: string;
  pay_currency?: string;
  network?: string;
  payin_hash?: string;
  outcome_hash?: string;
  order_id?: string;
};

export type CreatedCharge = {
  providerId: string;
  status: string;
  payAddress: string;
  payAmount: number;
  payCurrency: string;
  network: string | null;
  priceAmount: number;
  priceCurrency: string;
  /** Wallet URI (or bare address) to render as a QR code. */
  paymentUri: string;
  qrDataUrl: string;
};

/* -------------------------------- requests -------------------------------- */

async function callProvider(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<ProviderPayment> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new CryptoPaymentError(
      "Crypto deposits are not configured. Set CRYPTO_PAYMENT_API_KEY.",
      503,
      "CRYPTO_NOT_CONFIGURED",
    );
  }

  let response: Response;
  try {
    response = await fetch(`${getBaseUrl()}${path}`, {
      method: init.method,
      headers: {
        "x-api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    throw new CryptoPaymentError(
      `Could not reach the crypto payment gateway: ${reason}`,
      504,
      "CRYPTO_UNREACHABLE",
    );
  }

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new CryptoPaymentError(
      "The crypto gateway returned an unreadable response.",
      502,
      "CRYPTO_INVALID_JSON",
    );
  }

  if (!response.ok) {
    const message =
      (payload as { message?: string } | null)?.message ??
      `Crypto gateway returned HTTP ${response.status}.`;
    const code = (payload as { code?: string } | null)?.code;

    // A below-minimum amount is the caller's problem, not an upstream failure.
    if (code === "AMOUNT_MINIMAL_ERROR" || /less than minimal/i.test(message)) {
      throw new CryptoPaymentError(
        `${message}. Try a larger amount.`,
        400,
        "AMOUNT_TOO_SMALL",
      );
    }

    throw new CryptoPaymentError(message, 502, "CRYPTO_UPSTREAM_ERROR");
  }

  return (payload ?? {}) as ProviderPayment;
}

function toNumber(value: number | string | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** A scannable wallet URI where the scheme is well known, else the address. */
export function buildPaymentUri(
  asset: string,
  address: string,
  amount: number | null,
): string {
  const upper = asset.toUpperCase();
  if (upper === "BTC" && amount !== null) {
    return `bitcoin:${address}?amount=${amount}`;
  }
  if (upper === "ETH" && amount !== null) {
    return `ethereum:${address}?value=${amount}`;
  }
  return address;
}

export async function createCharge(input: {
  userId: string;
  asset: CryptoAsset;
  amountUsd: number;
  orderId: string;
  ipnCallbackUrl: string;
}): Promise<CreatedCharge> {
  const payload = await callProvider("/payment", {
    method: "POST",
    body: {
      price_amount: input.amountUsd,
      price_currency: DEFAULT_CURRENCY.toLowerCase(),
      pay_currency: input.asset.payCurrency,
      order_id: input.orderId,
      order_description: `BulkInvest deposit for ${input.userId}`,
      ipn_callback_url: input.ipnCallbackUrl,
    },
  });

  const providerId = payload.payment_id !== undefined ? String(payload.payment_id) : null;
  const payAddress = payload.pay_address ?? null;
  const payAmount = toNumber(payload.pay_amount);

  if (!providerId || !payAddress || payAmount === null) {
    throw new CryptoPaymentError(
      "The crypto gateway did not return a deposit address.",
      502,
      "CRYPTO_NO_ADDRESS",
    );
  }

  const paymentUri = buildPaymentUri(input.asset.asset, payAddress, payAmount);
  const qrDataUrl = await toDataURL(paymentUri, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
  });

  return {
    providerId,
    status: payload.payment_status ?? "waiting",
    payAddress,
    payAmount,
    payCurrency: payload.pay_currency ?? input.asset.payCurrency,
    network: payload.network ?? input.asset.network,
    priceAmount: toNumber(payload.price_amount) ?? input.amountUsd,
    priceCurrency: (payload.price_currency ?? DEFAULT_CURRENCY).toUpperCase(),
    paymentUri,
    qrDataUrl,
  };
}

/** Fetch the latest provider state (used to resolve the on-chain hash). */
export async function fetchPayment(
  providerId: string,
): Promise<{ status: string; txHash: string | null; payAmount: number | null }> {
  const payload = await callProvider(`/payment/${encodeURIComponent(providerId)}`, {
    method: "GET",
  });

  return {
    status: payload.payment_status ?? "waiting",
    txHash: payload.payin_hash ?? payload.outcome_hash ?? null,
    payAmount: toNumber(payload.pay_amount),
  };
}

/* ---------------------------------- IPN ----------------------------------- */

/** Final states that should credit the account. */
export const CREDITED_STATUSES = new Set(["confirmed", "finished", "sending"]);

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/**
 * Verify the `x-nowpayments-sig` header.
 *
 * NOWPayments signs the HMAC-SHA512 of the JSON body with keys sorted
 * recursively, using the IPN secret. Comparison is constant-time.
 */
export function verifyIpnSignature(
  rawBody: string,
  signature: string | null,
): boolean {
  const secret = getIpnSecret();
  if (!secret || !signature) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }

  const expected = createHmac("sha512", secret)
    .update(JSON.stringify(sortDeep(parsed)))
    .digest("hex");

  const provided = signature.trim().toLowerCase();
  if (provided.length !== expected.length) return false;

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

export type IpnPayload = {
  payment_id?: string | number;
  payment_status?: string;
  price_amount?: number | string;
  price_currency?: string;
  pay_amount?: number | string;
  pay_currency?: string;
  order_id?: string;
  payin_hash?: string;
  outcome_hash?: string;
};
