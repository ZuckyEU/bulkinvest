import type { Transaction } from "@prisma/client";

/**
 * Shared helpers for rendering a `Transaction` row.
 *
 * Deposits and trades share one table/feed, but differ in which columns carry
 * meaning: a trade's value is shares x price, a deposit's is its funded amount.
 */

export function isDepositTransaction(
  transaction: Pick<Transaction, "type">,
): boolean {
  return transaction.type === "DEPOSIT";
}

/** The displayed money value of a row. */
export function transactionTotal(
  transaction: Pick<Transaction, "type" | "shares" | "price" | "amount">,
): number {
  if (isDepositTransaction(transaction)) {
    return transaction.amount ?? 0;
  }
  const computed = transaction.shares * transaction.price;
  // A pending notional order has no qty/price yet; fall back to its amount.
  if (computed === 0 && typeof transaction.amount === "number") {
    return transaction.amount;
  }
  return computed;
}
