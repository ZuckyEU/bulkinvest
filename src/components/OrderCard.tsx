"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { formatUSD } from "@/lib/format";
import { formatQuantity, isCryptoSymbol, matchesSymbol } from "@/lib/symbols";
import type { AccountSummary } from "@/lib/account-types";

export type OrderSide = "BUY" | "SELL";
type InputMode = "SHARES" | "AMOUNT";
type SubmitState = "idle" | "submitting" | "success" | "error";

type OrderCardProps = {
  symbol: string;
  name: string;
  price: number | null;
  account: AccountSummary | null;
  accountError?: string | null;
  onTraded: () => void;
  /** Preselect a side, e.g. "SELL" when arriving to close a position. */
  initialSide?: OrderSide;
  /**
   * Bump to pre-fill a full-position sell from outside the card.
   *
   * The asset page shows its own "Close position" button above the chart, and
   * this lets that button drive the ticket instead of duplicating the form.
   * Incrementing the counter is the trigger; 0 means "no external request".
   */
  closeSignal?: number;
};

type FillSummary = {
  shares: number;
  price: number;
  total: number;
  /** Null for broker orders (the broker holds the cash, not this app). */
  cashBalance: number | null;
  queued: boolean;
  pending: boolean;
  status: string | null;
  message: string | null;
};

/**
 * Order precision.
 *
 * Equities are quotable to 6 decimals, but crypto balances are far smaller
 * (e.g. 0.00034704 BTC). Flooring a crypto position to 6dp would leave dust on
 * the books after a "sell all", so crypto is handled at 8dp.
 */
const EQUITY_SHARE_STEP = 1_000_000;
const CRYPTO_SHARE_STEP = 100_000_000;

/** Match the server's share precision so the estimate equals what is sent. */
function floorShares(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value * step) / step;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function OrderCard({
  symbol,
  name,
  price,
  account,
  accountError,
  onTraded,
  initialSide,
  closeSignal = 0,
}: OrderCardProps) {
  const [side, setSide] = useState<OrderSide>(initialSide ?? "BUY");
  const [inputMode, setInputMode] = useState<InputMode>("SHARES");
  const [sharesInput, setSharesInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [status, setStatus] = useState<SubmitState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState<FillSummary | null>(null);

  const orderTypeId = useId();
  const inputId = useId();

  // Switching ticker means a new order: clear the form and any prior receipt.
  useEffect(() => {
    setSharesInput("");
    setAmountInput("");
    setStatus("idle");
    setError(null);
    setFill(null);
  }, [symbol]);

  // Alpaca reports crypto pairs as `BTCUSD` while our routes use `BTC/USD`, so
  // match loosely or a real holding would look like zero.
  const heldShares =
    account?.holdings.find((holding) => matchesSymbol(holding.symbol, symbol))?.shares ?? 0;
  const buyingPower = account?.cashBalance ?? 0;

  const shareStep = isCryptoSymbol(symbol) ? CRYPTO_SHARE_STEP : EQUITY_SHARE_STEP;
  /** The most sellable units, so "sell all" never leaves fractional dust. */
  const maxSellShares = floorShares(heldShares, shareStep);

  const requestedShares = useMemo(() => {
    if (price === null || price <= 0) return 0;

    if (inputMode === "SHARES") {
      return floorShares(toNumber(sharesInput), shareStep);
    }

    const amount = toNumber(amountInput);
    return floorShares(amount / price, shareStep);
  }, [inputMode, sharesInput, amountInput, price, shareStep]);

  const estimatedTotal =
    price !== null && requestedShares > 0 ? requestedShares * price : 0;

  const validationMessage = useMemo(() => {
    if (price === null || price <= 0) return "Waiting for a live price.";
    if (!account) return null;
    if (requestedShares <= 0) return null;

    if (side === "BUY" && estimatedTotal > buyingPower) {
      return `Insufficient buying power. This order costs ${formatUSD(
        estimatedTotal,
      )} but only ${formatUSD(buyingPower)} is available.`;
    }

    if (side === "SELL" && requestedShares > heldShares) {
      return `Insufficient shares. You hold ${heldShares} ${symbol}.`;
    }

    return null;
  }, [
    account,
    buyingPower,
    estimatedTotal,
    heldShares,
    price,
    requestedShares,
    side,
    symbol,
  ]);

  const canSubmit =
    Boolean(account) &&
    price !== null &&
    price > 0 &&
    requestedShares > 0 &&
    validationMessage === null &&
    status !== "submitting";

  function applyMax() {
    if (price === null || price <= 0 || !account) return;

    if (side === "BUY") {
      if (inputMode === "SHARES") {
        setSharesInput(String(floorShares(buyingPower / price, shareStep)));
      } else {
        setAmountInput(buyingPower.toFixed(2));
      }
      return;
    }

    if (inputMode === "SHARES") {
      setSharesInput(String(maxSellShares));
    } else {
      setAmountInput((maxSellShares * price).toFixed(2));
    }
  }

  /**
   * Close out the whole position: switch to a market sell of every unit held.
   *
   * Only pre-fills the ticket — the user still confirms and submits, so a
   * one-click misfire cannot liquidate a position.
   */
  function closePosition() {
    setSide("SELL");
    setInputMode("SHARES");
    setSharesInput(String(maxSellShares));
    setStatus("idle");
    setError(null);
    setFill(null);
  }

  // Mirror closePosition() for an external trigger (the asset page banner).
  useEffect(() => {
    if (closeSignal <= 0) return;
    setSide("SELL");
    setInputMode("SHARES");
    setSharesInput(String(maxSellShares));
    setStatus("idle");
    setError(null);
    setFill(null);
  }, [closeSignal, maxSellShares]);

  async function submitOrder() {
    if (!account || price === null) return;

    setStatus("submitting");
    setError(null);
    setFill(null);

    try {
      const response = await fetch(
        `/api/trade/${side === "BUY" ? "buy" : "sell"}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            symbol,
            shares: requestedShares,
          }),
        },
      );

      const body = await response.json();

      if (!response.ok) {
        throw new Error(body?.error ?? "The order could not be placed.");
      }

      if (body?.order) {
        // Broker (Alpaca) response: the fill may not have happened yet, so fall
        // back to the pre-trade reference price rather than showing $0.00.
        const order = body.order;
        const qty =
          typeof order.filledQty === "number" && order.filledQty > 0
            ? order.filledQty
            : (order.qty ?? 0);
        const px =
          typeof order.filledAvgPrice === "number" && order.filledAvgPrice > 0
            ? order.filledAvgPrice
            : (typeof body.referencePrice === "number" ? body.referencePrice : 0);

        setFill({
          shares: qty,
          price: px,
          total: qty * px || (typeof order.notional === "number" ? order.notional : 0),
          cashBalance: null,
          queued: body.queued === true,
          pending: body.pending === true,
          status: order.status ?? null,
          message: body.message ?? null,
        });
      } else {
        // Local paper ledger response.
        setFill({
          shares: body.shares,
          price: body.price,
          total: body.total,
          cashBalance: body.cashBalance,
          queued: false,
          pending: false,
          status: "filled",
          message: null,
        });
      }

      setSharesInput("");
      setAmountInput("");
      setStatus("success");
      onTraded();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The order could not be placed.",
      );
      setStatus("error");
    }
  }

  const isBuy = side === "BUY";

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Place order</h2>
          <p className="mt-1 text-xs text-slate-500">
            Fills at the live market price · queued if the market is closed
          </p>
        </div>
        <span className="rounded-lg bg-white/5 px-2.5 py-1 font-mono text-xs font-semibold text-slate-300">
          {symbol}
        </span>
      </div>

      {/* Close position — prominent when this asset is already held. */}
      {heldShares > 0 ? (
        <button
          type="button"
          onClick={closePosition}
          aria-pressed={side === "SELL" && requestedShares === maxSellShares}
          className="mt-4 w-full rounded-xl border border-rose-400/30 bg-rose-400/[0.08] px-4 py-3 text-left transition-colors hover:bg-rose-400/[0.14] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60"
        >
          <span className="block text-sm font-semibold text-rose-300">
            Close position — sell all {formatQuantity(maxSellShares)} {symbol}
          </span>
          <span className="mt-0.5 block text-xs text-slate-400">
            {side === "SELL" && requestedShares === maxSellShares
              ? "Pre-filled below. Review and confirm to submit."
              : "Pre-fills a market sell of your entire holding."}
          </span>
        </button>
      ) : null}

      {/* Order type */}
      <label
        htmlFor={orderTypeId}
        className="mt-5 block text-xs font-medium text-slate-400"
      >
        Order type
      </label>
      <select
        id={orderTypeId}
        value={side}
        onChange={(event) => {
          setSide(event.target.value as OrderSide);
          setStatus("idle");
          setError(null);
          setFill(null);
        }}
        className={`mt-2 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 ${
          isBuy
            ? "focus:border-emerald-400/40 focus:ring-emerald-400/20"
            : "focus:border-rose-400/40 focus:ring-rose-400/20"
        }`}
      >
        <option value="BUY" className="bg-white text-slate-900" style={{ backgroundColor: "#ffffff", color: "#0f172a" }}>
          Market Buy
        </option>
        <option value="SELL" className="bg-white text-slate-900" style={{ backgroundColor: "#ffffff", color: "#0f172a" }}>
          Market Sell
        </option>
      </select>

      {/* Input mode */}
      <div className="mt-4 flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
        {(
          [
            { mode: "SHARES", label: "Shares" },
            { mode: "AMOUNT", label: "Dollar amount" },
          ] as const
        ).map((option) => (
          <button
            key={option.mode}
            type="button"
            aria-pressed={inputMode === option.mode}
            onClick={() => setInputMode(option.mode)}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              inputMode === option.mode
                ? "bg-white/10 text-white"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* Quantity */}
      <label
        htmlFor={inputId}
        className="mt-4 block text-xs font-medium text-slate-400"
      >
        {inputMode === "SHARES" ? "Number of shares" : "Dollar amount"}
      </label>
      <div className="relative mt-2">
        {inputMode === "AMOUNT" ? (
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-slate-500">
            $
          </span>
        ) : null}
        <input
          id={inputId}
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          autoComplete="off"
          value={inputMode === "SHARES" ? sharesInput : amountInput}
          onChange={(event) => {
            if (inputMode === "SHARES") setSharesInput(event.target.value);
            else setAmountInput(event.target.value);
            setStatus("idle");
            setError(null);
            setFill(null);
          }}
          placeholder={inputMode === "SHARES" ? "0" : "0.00"}
          className={`w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 ${
            inputMode === "AMOUNT" ? "pl-7 pr-20" : "pl-3.5 pr-20"
          } ${isBuy ? "focus:border-emerald-400/40 focus:ring-emerald-400/20" : "focus:border-rose-400/40 focus:ring-rose-400/20"}`}
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
          <button
            type="button"
            onClick={applyMax}
            disabled={!account || price === null}
            className="rounded-md px-2 py-1 text-xs font-semibold text-slate-400 transition-colors hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Max
          </button>
        </div>
      </div>

      {/* Estimate */}
      <dl className="mt-5 space-y-2.5 border-t border-white/5 pt-4 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Estimated price</dt>
          <dd className="font-medium text-slate-200">
            {price !== null ? formatUSD(price) : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-500">Shares</dt>
          <dd className="font-mono text-slate-200">
            {requestedShares > 0 ? requestedShares : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">Estimated total</dt>
          <dd className="text-base font-semibold text-white">
            {estimatedTotal > 0 ? formatUSD(estimatedTotal) : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between border-t border-white/5 pt-2.5">
          <dt className="text-slate-500">
            {isBuy ? "Buying power" : `${symbol} held`}
          </dt>
          <dd
            className={`font-medium ${
              isBuy
                ? "text-slate-300"
                : heldShares > 0
                  ? "text-slate-300"
                  : "text-slate-500"
            }`}
          >
            {!account
              ? "—"
              : isBuy
                ? formatUSD(buyingPower)
                : formatQuantity(heldShares)}
          </dd>
        </div>
      </dl>

      {accountError ? (
        <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
          {accountError}
        </p>
      ) : null}

      {!account && !accountError ? (
        <p className="mt-4 text-xs text-slate-500">Loading account…</p>
      ) : null}

      {validationMessage && status !== "success" ? (
        <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs text-amber-300">
          {validationMessage}
        </p>
      ) : null}

      {status === "error" && error ? (
        <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-300">
          {error}
        </p>
      ) : null}

      {status === "success" && fill ? (
        <div
          className={`mt-4 rounded-xl border p-3 ${
            fill.queued || fill.pending
              ? "border-amber-400/20 bg-amber-400/[0.06]"
              : "border-emerald-400/20 bg-emerald-400/[0.06]"
          }`}
        >
          <p
            className={`text-xs font-semibold ${
              fill.queued || fill.pending ? "text-amber-300" : "text-emerald-300"
            }`}
          >
            {fill.queued
              ? "Order queued for market open"
              : fill.pending
                ? "Order accepted — awaiting fill"
                : "Order filled"}
          </p>

          {fill.message ? (
            <p className="mt-1 text-xs text-slate-400">{fill.message}</p>
          ) : null}

          <p className="mt-1 text-xs text-slate-400">
            {fill.shares > 0 ? `${fill.shares} units` : "Order"}
            {fill.price > 0 ? ` at ${formatUSD(fill.price)}` : ""}
          </p>
          {fill.total > 0 ? (
            <p className="mt-0.5 text-xs text-slate-400">
              Total {formatUSD(fill.total)}
            </p>
          ) : null}
          {fill.cashBalance !== null ? (
            <p className="mt-0.5 text-xs text-slate-500">
              Cash balance {formatUSD(fill.cashBalance)}
            </p>
          ) : null}
          {fill.status ? (
            <p className="mt-0.5 text-xs text-slate-500">Status: {fill.status}</p>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={submitOrder}
        disabled={!canSubmit}
        className={`mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold transition-transform disabled:cursor-not-allowed disabled:opacity-40 ${
          isBuy
            ? "bg-gradient-to-r from-emerald-400 to-sky-500 text-slate-950 enabled:hover:scale-[1.02]"
            : "bg-gradient-to-r from-rose-400 to-orange-400 text-slate-950 enabled:hover:scale-[1.02]"
        }`}
      >
        {status === "submitting"
          ? "Placing order…"
          : `${isBuy ? "Buy" : "Sell"} ${symbol}`}
      </button>

      <p className="mt-3 text-center text-xs text-slate-600">{name}</p>
    </section>
  );
}
