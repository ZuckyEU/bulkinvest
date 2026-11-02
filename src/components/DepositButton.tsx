"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type CryptoAssetOption = {
  asset: string;
  payCurrency: string;
  network: string;
  name: string;
  /** Gateway minimum for this asset, in USD. */
  minDepositUsd: number;
};

type PaymentConfig = {
  card: { enabled: boolean };
  crypto: { enabled: boolean; assets: CryptoAssetOption[] };
  currency: string;
  minDeposit: number;
  maxDeposit: number;
};

type CryptoCharge = {
  depositId: string;
  asset: string;
  name: string;
  network: string;
  payCurrency: string;
  amountUsd: number;
  priceCurrency: string;
  payAddress: string;
  payAmount: number;
  paymentUri: string;
  qrDataUrl: string;
  status: string;
};

type CryptoStatus = {
  depositId: string;
  status: string;
  credited: boolean;
  txHash: string | null;
  payAmount: number | null;
  amountUsd: number;
};

type Tab = "card" | "crypto";
type SubmitState = "idle" | "submitting" | "awaiting" | "error";

const QUICK_AMOUNTS = [25, 50, 100, 500];
const CRYPTO_POLL_MS = 10_000;
/** Statuses that will never credit, so polling can stop. */
const CRYPTO_TERMINAL = new Set(["failed", "refunded", "expired", "creating"]);

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/20";

function formatAmount(amount: number, currency: string): string {
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
  return currency === "USD" ? formatted : `${formatted} ${currency}`;
}

function formatCrypto(amount: number, asset: string): string {
  const digits = amount < 1 ? 8 : 6;
  return `${amount.toFixed(digits).replace(/\.?0+$/, "")} ${asset}`;
}

/**
 * "Add funds" button + deposit modal.
 *
 * Two funding paths:
 *  - Card: Stripe Checkout; credited by its webhook.
 *  - Crypto: a gateway-issued wallet address + QR; credited by the on-chain
 *    webhook once the transfer confirms. The modal polls for that.
 */
export function DepositButton({ depositStatus }: { depositStatus?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("card");
  const [config, setConfig] = useState<PaymentConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [amount, setAmount] = useState("50");
  const [asset, setAsset] = useState("USDT");
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);

  const [charge, setCharge] = useState<CryptoCharge | null>(null);
  const [cryptoStatus, setCryptoStatus] = useState<CryptoStatus | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | null>(null);

  // A Stripe webhook can land a moment after the browser is redirected back.
  useEffect(() => {
    if (depositStatus !== "success") return;
    const timers = [1500, 4000].map((ms) =>
      window.setTimeout(() => router.refresh(), ms),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [depositStatus, router]);

  const loadConfig = useCallback(async () => {
    setConfigError(null);
    try {
      const response = await fetch("/api/payments/config", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body?.error ?? "Could not load payment options.");
      }
      const parsed = body as PaymentConfig;
      setConfig(parsed);
      // Default to whichever path is actually available.
      if (!parsed.card?.enabled && parsed.crypto?.enabled) setTab("crypto");
      if (parsed.crypto?.assets?.length) setAsset(parsed.crypto.assets[0].asset);
    } catch (caught) {
      setConfigError(
        caught instanceof Error ? caught.message : "Could not load payment options.",
      );
    }
  }, []);

  useEffect(() => {
    if (open && !config) void loadConfig();
  }, [open, config, loadConfig]);

  // Poll the crypto deposit until it is credited or definitively fails.
  const cryptoCredited = cryptoStatus?.credited === true;
  const cryptoState = cryptoStatus?.status;
  useEffect(() => {
    if (!charge || cryptoCredited) return;
    if (cryptoState && CRYPTO_TERMINAL.has(cryptoState)) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch(
          `/api/payments/crypto/status?id=${encodeURIComponent(charge.depositId)}`,
          { cache: "no-store" },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok || cancelled) return;

        setCryptoStatus(body as CryptoStatus);
        if ((body as CryptoStatus).credited) router.refresh();
      } catch {
        // transient; the next tick retries
      }
    };

    void poll();
    const timer = window.setInterval(poll, CRYPTO_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [charge, cryptoCredited, cryptoState, router]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  function close() {
    setOpen(false);
    setState("idle");
    setError(null);
    setCharge(null);
    setCryptoStatus(null);
    setCopied(false);
  }

  const currency = config?.currency ?? "USD";
  const min = config?.minDeposit ?? 5;
  const max = config?.maxDeposit ?? 100000;

  // Crypto has a higher, per-asset minimum set by the gateway.
  const selectedCrypto = config?.crypto?.assets?.find(
    (option) => option.asset === asset,
  );
  const cryptoMin = selectedCrypto?.minDepositUsd ?? min;
  const activeMin = tab === "crypto" ? cryptoMin : min;

  const numericAmount = Number(amount);
  const amountValid =
    Number.isFinite(numericAmount) && numericAmount >= activeMin && numericAmount <= max;

  async function submitCard(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;

    setState("submitting");
    setError(null);

    try {
      const response = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: Number(amount) }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? "Could not start the payment.");
        setState("error");
        return;
      }

      if (typeof body?.url === "string") {
        window.location.assign(body.url);
        return;
      }

      setError("The payment provider did not return a checkout URL.");
      setState("error");
    } catch {
      setError("Could not start the payment. Please try again.");
      setState("error");
    }
  }

  async function submitCrypto(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;

    // Minimum/maximum are validated here rather than via native input
    // constraints, which conflict with the gateway's fractional minimum.
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a deposit amount.");
      setState("error");
      return;
    }
    if (value < cryptoMin) {
      setError(
        `The minimum deposit for ${asset} is ${formatAmount(cryptoMin, currency)}.`,
      );
      setState("error");
      return;
    }
    if (value > max) {
      setError(`The maximum deposit is ${formatAmount(max, currency)}.`);
      setState("error");
      return;
    }

    setState("submitting");
    setError(null);
    setCharge(null);
    setCryptoStatus(null);

    try {
      const response = await fetch("/api/payments/crypto/create-charge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset, amount: Number(amount) }),
      });
      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? "Could not create the deposit address.");
        setState("error");
        return;
      }

      const created = body as CryptoCharge;
      setCharge(created);
      setCryptoStatus({
        depositId: created.depositId,
        status: created.status,
        credited: false,
        txHash: null,
        payAmount: created.payAmount,
        amountUsd: created.amountUsd,
      });
      setState("awaiting");
    } catch {
      setError("Could not create the deposit address. Please try again.");
      setState("error");
    }
  }

  async function copyAddress() {
    if (!charge) return;
    try {
      await navigator.clipboard.writeText(charge.payAddress);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const credited = cryptoStatus?.credited === true;
  const cryptoTabAvailable = config?.crypto?.enabled === true;
  const cardTabAvailable = config?.card?.enabled === true;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition-transform hover:scale-[1.03]"
      >
        Add funds
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="deposit-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0e18] p-6 shadow-2xl shadow-black/60"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="deposit-title" className="text-lg font-semibold text-white">
                  Add funds
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Deposit virtual cash into your paper-trading account.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg px-2 py-1 text-slate-500 transition-colors hover:bg-white/5 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Funding path */}
            <div className="mt-4 flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
              {(
                [
                  { id: "card", label: "Card", enabled: cardTabAvailable },
                  { id: "crypto", label: "Crypto", enabled: cryptoTabAvailable },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  disabled={!option.enabled || state === "awaiting"}
                  aria-pressed={tab === option.id}
                  onClick={() => {
                    setTab(option.id);
                    setError(null);
                    setState("idle");
                  }}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    tab === option.id
                      ? "bg-white/10 text-white"
                      : "text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {configError ? (
              <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-300">
                {configError}
              </p>
            ) : null}

            {!config && !configError ? (
              <p className="mt-4 text-xs text-slate-500">Loading payment options…</p>
            ) : null}

            {/* ---------------------------- crypto: show address -------------- */}
            {tab === "crypto" && charge ? (
              <div className="mt-5 space-y-4">
                {credited ? (
                  <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
                    <p className="text-xs font-semibold text-emerald-300">
                      Deposit confirmed
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatAmount(charge.amountUsd, charge.priceCurrency)} credited.
                      {cryptoStatus?.txHash ? " On-chain hash recorded." : ""}
                    </p>
                  </div>
                ) : (
                  <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
                    Send exactly{" "}
                    <span className="font-semibold">
                      {formatCrypto(charge.payAmount, charge.asset)}
                    </span>{" "}
                    on {charge.network}. Your balance updates once the network
                    confirms the transfer.
                  </p>
                )}

                <div className="flex justify-center rounded-xl border border-white/10 bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={charge.qrDataUrl}
                    alt={`${charge.asset} deposit address QR code`}
                    width={200}
                    height={200}
                  />
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-400">
                    {charge.name} address ({charge.network})
                  </p>
                  <div className="mt-2 flex items-stretch gap-2">
                    <code className="min-w-0 flex-1 break-all rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-slate-200">
                      {charge.payAddress}
                    </code>
                    <button
                      type="button"
                      onClick={copyAddress}
                      className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-white transition-colors hover:bg-white/10"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>

                <dl className="space-y-2 border-t border-white/5 pt-4 text-xs">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Amount due</dt>
                    <dd className="font-mono text-slate-200">
                      {formatCrypto(charge.payAmount, charge.asset)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Credited value</dt>
                    <dd className="text-slate-200">
                      {formatAmount(charge.amountUsd, charge.priceCurrency)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Status</dt>
                    <dd className={credited ? "text-emerald-400" : "text-amber-300"}>
                      {credited ? "confirmed" : (cryptoStatus?.status ?? charge.status)}
                    </dd>
                  </div>
                </dl>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCharge(null);
                      setCryptoStatus(null);
                      setState("idle");
                    }}
                    className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/10"
                  >
                    New deposit
                  </button>
                  <button
                    type="button"
                    onClick={close}
                    className="flex-1 rounded-xl bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-2.5 text-sm font-semibold text-slate-950"
                  >
                    Done
                  </button>
                </div>

                {!credited ? (
                  <p className="text-center text-xs text-slate-600">
                    Checking for confirmations every {CRYPTO_POLL_MS / 1000}s.
                  </p>
                ) : null}
              </div>
            ) : tab === "crypto" ? (
              /* ---------------------------- crypto: request address -------- */
              <form onSubmit={submitCrypto} className="mt-5 space-y-4">
                {!cryptoTabAvailable ? (
                  <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
                    Crypto deposits are not configured. Set CRYPTO_PAYMENT_API_KEY
                    and CRYPTO_PAYMENT_WEBHOOK_SECRET.
                  </p>
                ) : null}

                <div>
                  <label htmlFor="crypto-asset" className="text-xs font-medium text-slate-400">
                    Asset
                  </label>
                  <select
                    id="crypto-asset"
                    value={asset}
                    onChange={(event) => setAsset(event.target.value)}
                    disabled={!cryptoTabAvailable}
                    className={`mt-2 ${fieldClass}`}
                  >
                    {(config?.crypto?.assets ?? []).map((option) => (
                      <option
                        key={option.asset}
                        value={option.asset}
                        className="bg-white text-black"
                        style={{ backgroundColor: "#ffffff", color: "#000000" }}
                      >
                        {option.asset} — {option.network}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="crypto-amount" className="text-xs font-medium text-slate-400">
                    Amount (USD)
                  </label>
                  <input
                    id="crypto-amount"
                    type="number"
                    // No native min/max/step: the browser's step validation
                    // rejects whole numbers against a fractional minimum. The
                    // minimum is enforced on submit instead.
                    step="any"
                    inputMode="decimal"
                    value={amount}
                    disabled={!cryptoTabAvailable}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setState("idle");
                      setError(null);
                    }}
                    className={`mt-2 ${fieldClass}`}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {QUICK_AMOUNTS.filter((value) => value >= cryptoMin).map((value) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!cryptoTabAvailable}
                        onClick={() => {
                          setAmount(String(value));
                          setState("idle");
                          setError(null);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-emerald-400/30 hover:text-white disabled:opacity-40"
                      >
                        ${value}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Minimum {formatAmount(cryptoMin, currency)} for {asset} · maximum{" "}
                    {formatAmount(max, currency)}.
                  </p>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-300"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={!cryptoTabAvailable || state === "submitting"}
                  className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-transform enabled:hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state === "submitting"
                    ? "Generating address…"
                    : "Generate deposit address"}
                </button>
              </form>
            ) : (
              /* ---------------------------- card --------------------------- */
              <form onSubmit={submitCard} className="mt-5 space-y-4">
                {!cardTabAvailable ? (
                  <p className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
                    Card payments are not configured. Set STRIPE_SECRET_KEY.
                  </p>
                ) : null}

                <div>
                  <label htmlFor="deposit-amount" className="text-xs font-medium text-slate-400">
                    Amount ({currency})
                  </label>
                  <input
                    id="deposit-amount"
                    type="number"
                    min={min}
                    max={max}
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    disabled={!cardTabAvailable}
                    onChange={(event) => {
                      setAmount(event.target.value);
                      setState("idle");
                      setError(null);
                    }}
                    className={`mt-2 ${fieldClass}`}
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {QUICK_AMOUNTS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!cardTabAvailable}
                        onClick={() => {
                          setAmount(String(value));
                          setState("idle");
                          setError(null);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-emerald-400/30 hover:text-white disabled:opacity-40"
                      >
                        {formatAmount(value, currency)}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Between {formatAmount(min, currency)} and {formatAmount(max, currency)}.
                  </p>
                </div>

                {error ? (
                  <p
                    role="alert"
                    className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-300"
                  >
                    {error}
                  </p>
                ) : null}

                <button
                  type="submit"
                  disabled={!cardTabAvailable || state === "submitting" || !amountValid}
                  className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-transform enabled:hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state === "submitting" ? "Starting payment..." : "Continue to card payment"}
                </button>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
