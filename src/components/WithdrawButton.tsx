"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type AssetOption = {
  asset: string;
  network: string;
  name: string;
};

type WithdrawalRequest = {
  reference: string;
  asset: string;
  network: string;
  amountUsd: number;
  address: string;
  status: string;
};

const QUICK_AMOUNTS = [50, 100, 250, 500];
const MIN_USD = 10;
const MAX_USD = 100_000;
/** How long the success toast stays on screen. */
const TOAST_MS = 6000;

const fieldClass =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-600 focus:border-emerald-400/40 focus:outline-none focus:ring-2 focus:ring-emerald-400/20";

const selectFieldClass = `${fieldClass} text-slate-900`;

const ASSETS: AssetOption[] = [
  { asset: "USDT", network: "TRON (TRC20)", name: "Tether USD" },
  { asset: "BTC", network: "Bitcoin", name: "Bitcoin" },
  { asset: "ETH", network: "Ethereum (ERC20)", name: "Ethereum" },
];

type SubmitState = "idle" | "submitting" | "error";

/**
 * "Withdraw" button + request modal.
 *
 * Submitting records a PENDING request for the operator to action. It
 * deliberately does not send anything on-chain, so the confirmation copy is
 * about "submitted", not "sent".
 */
export function WithdrawButton() {
  const [open, setOpen] = useState(false);
  const [asset, setAsset] = useState(ASSETS[0].asset);
  const [amount, setAmount] = useState("100");
  const [address, setAddress] = useState("");
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<WithdrawalRequest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const selected = ASSETS.find((entry) => entry.asset === asset) ?? ASSETS[0];
  const numericAmount = Number(amount);
  const amountValid =
    Number.isFinite(numericAmount) && numericAmount >= MIN_USD && numericAmount <= MAX_USD;
  const addressReady = address.trim().length >= 12;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }

  function close() {
    setOpen(false);
    setState("idle");
    setError(null);
    setCreated(null);
    setAddress("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "submitting") return;

    setState("submitting");
    setError(null);

    try {
      const response = await fetch("/api/withdrawals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ asset, amountUsd: Number(amount), address: address.trim() }),
      });

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not submit the withdrawal request.");
        setState("error");
        return;
      }

      const request = body.request as WithdrawalRequest;
      setCreated(request);
      setState("idle");
      showToast("Withdrawal request submitted for processing");
    } catch {
      setError("Could not submit the withdrawal request. Please try again.");
      setState("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
      >
        Withdraw
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
            aria-labelledby="withdraw-title"
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#0a0e18] p-6 shadow-2xl shadow-black/60"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="withdraw-title" className="text-lg font-semibold text-white">
                  Withdraw crypto
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Submit a request for review before funds leave the platform.
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

            {created ? (
              <div className="mt-5 space-y-4">
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
                  <p className="text-xs font-semibold text-emerald-300">
                    Withdrawal request submitted for processing
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    We&apos;ll review it and send {created.asset} to your address once
                    approved.
                  </p>
                </div>

                <dl className="space-y-2 border-t border-white/5 pt-4 text-xs">
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Reference</dt>
                    <dd className="font-mono text-slate-200">{created.reference}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Amount</dt>
                    <dd className="text-slate-200">
                      ${created.amountUsd.toLocaleString("en-US", {
                        minimumFractionDigits: 2,
                      })}{" "}
                      <span className="text-slate-500">({created.asset})</span>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Network</dt>
                    <dd className="text-slate-200">{created.network}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-slate-500">Status</dt>
                    <dd className="font-medium text-amber-300">{created.status}</dd>
                  </div>
                </dl>

                <div>
                  <p className="text-xs font-medium text-slate-400">Destination</p>
                  <code className="mt-2 block break-all rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 font-mono text-xs text-slate-200">
                    {created.address}
                  </code>
                </div>

                <button
                  type="button"
                  onClick={close}
                  className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-3 text-sm font-semibold text-slate-950"
                >
                  Done
                </button>
              </div>
            ) : (
              <form onSubmit={submit} className="mt-5 space-y-4">
                <div>
                  <label htmlFor="withdraw-asset" className="text-xs font-medium text-slate-400">
                    Asset &amp; network
                  </label>
                  <select
                    id="withdraw-asset"
                    value={asset}
                    onChange={(event) => {
                      setAsset(event.target.value);
                      setState("idle");
                      setError(null);
                    }}
                    className={`mt-2 ${selectFieldClass}`}
                  >
                    {ASSETS.map((option) => (
                      <option
                        key={option.asset}
                        value={option.asset}
                        className="bg-white text-slate-900"
                        style={{ backgroundColor: "#ffffff", color: "#0f172a" }}
                      >
                        {option.asset} — {option.network}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="withdraw-amount" className="text-xs font-medium text-slate-400">
                    Amount (USD)
                  </label>
                  <input
                    id="withdraw-amount"
                    type="number"
                    // Validated on submit: native step validation conflicts with
                    // the fractional/decimal amount the field accepts.
                    step="any"
                    inputMode="decimal"
                    value={amount}
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
                        onClick={() => {
                          setAmount(String(value));
                          setState("idle");
                          setError(null);
                        }}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-emerald-400/30 hover:text-white"
                      >
                        ${value}
                      </button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-600">
                    Minimum ${MIN_USD} · maximum ${MAX_USD.toLocaleString("en-US")}.
                  </p>
                </div>

                <div>
                  <label htmlFor="withdraw-address" className="text-xs font-medium text-slate-400">
                    Destination wallet address
                  </label>
                  <input
                    id="withdraw-address"
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    value={address}
                    onChange={(event) => {
                      setAddress(event.target.value);
                      setState("idle");
                      setError(null);
                    }}
                    placeholder={
                      asset === "BTC"
                        ? "bc1q… or 1A1z…"
                        : asset === "ETH"
                          ? "0x…"
                          : "T…"
                    }
                    className={`mt-2 ${fieldClass} font-mono`}
                  />
                  <p className="mt-2 text-xs text-slate-600">
                    Sending to {selected.name} on {selected.network}. Check the address
                    carefully — transfers cannot be reversed.
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
                  disabled={state === "submitting" || !addressReady || !amountValid}
                  className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-transform enabled:hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {state === "submitting" ? "Submitting…" : "Submit withdrawal request"}
                </button>

                <p className="text-center text-xs text-slate-600">
                  Requests are reviewed manually. No funds move until one is approved.
                </p>
              </form>
            )}
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-[110] flex max-w-sm items-start gap-3 rounded-xl border border-emerald-400/20 bg-[#0a0e18] px-4 py-3 shadow-2xl shadow-black/60"
        >
          <span
            className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-[11px] font-bold text-emerald-300"
            aria-hidden="true"
          >
            ✓
          </span>
          <p className="text-sm text-slate-200">{toast}</p>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="-mr-1 shrink-0 rounded-lg px-1 text-slate-500 transition-colors hover:text-white"
          >
            ✕
          </button>
        </div>
      ) : null}
    </>
  );
}