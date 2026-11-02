/**
 * Currency conversion to USD.
 *
 * Deposits may be made in a provider's local currency (e.g. NGN on a Paystack
 * account), but the ledger — cashBalance, holdings, P&L — is denominated in
 * USD. Conversion happens once, at credit time, so the rest of the app never
 * has to think about currencies.
 *
 * Rates come from a free, key-less endpoint and are cached for an hour. If it
 * is unreachable we fall back to approximate static rates so a deposit is never
 * silently dropped; the log records when that happens.
 */

const FETCH_TIMEOUT_MS = 5000;

/** Rough USD-per-unit rates, used only when the live API is unavailable. */
const FALLBACK_USD_PER_UNIT: Record<string, number> = {
  USD: 1,
  NGN: 1 / 1600,
  EUR: 1.08,
  GBP: 1.27,
  CAD: 0.73,
  AUD: 0.66,
  ZAR: 0.055,
  INR: 0.012,
  KES: 1 / 130,
  GHS: 1 / 15,
};

type RatesResponse = {
  result?: string;
  rates?: Record<string, unknown>;
};

/** Convert `amount` in `currency` (ISO code) to USD. */
export async function convertToUsd(
  amount: number,
  currency: string,
): Promise<number> {
  const code = (currency || "USD").trim().toUpperCase();
  if (!Number.isFinite(amount) || amount === 0) return 0;
  if (code === "USD") return amount;

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      next: { revalidate: 3600 },
    });

    if (response.ok) {
      const payload = (await response.json()) as RatesResponse;
      const rate = payload.rates?.[code];
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        return amount / rate;
      }
    }
  } catch {
    // fall through to the static table
  }

  const fallback = FALLBACK_USD_PER_UNIT[code];
  if (fallback !== undefined) {
    console.warn(
      `[fx] Live rate unavailable for ${code}; using approximate rate ${fallback}.`,
    );
    return amount * fallback;
  }

  // Unknown currency: treat as 1:1 rather than dropping the deposit.
  console.warn(`[fx] No rate known for ${code}; treating as USD 1:1.`);
  return amount;
}
