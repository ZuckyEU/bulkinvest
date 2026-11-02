import { prisma } from "@/lib/prisma";
import type { PlacedOrder } from "@/lib/alpaca";

/**
 * Local audit trail for orders submitted to Alpaca.
 *
 * Alpaca owns positions and cash, so this deliberately does NOT touch
 * Holdings or cashBalance — it only records what was sent, keyed on the
 * Alpaca order id (unique), so a retry cannot double-log.
 */
export async function logAlpacaOrder(
  userId: string,
  order: PlacedOrder,
  /** Pre-trade quote, used when the order has not filled yet. */
  referencePrice?: number | null,
): Promise<void> {
  const reference = order.id ?? order.clientOrderId;
  if (!reference) return;

  // A queued/unfilled order has no fill price; fall back to the quote captured
  // before submission so the ledger never records a $0.00 trade.
  const price =
    order.filledAvgPrice > 0 ? order.filledAvgPrice : (referencePrice ?? 0);
  const shares = order.filledQty > 0 ? order.filledQty : order.qty;

  try {
    await prisma.transaction.create({
      data: {
        userId,
        symbol: order.symbol,
        type: order.side === "buy" ? "BUY" : "SELL",
        shares,
        price,
        amount: null,
        currency: null,
        provider: "alpaca",
        reference,
      },
    });
  } catch (error) {
    // Reference already logged (duplicate submit): not an error worth failing on.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return;
    }
    // Logging must never break a successfully submitted order.
    console.error("Could not log the Alpaca order locally:", error);
  }
}
