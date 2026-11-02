const prisma: any = {};
export { prisma };

/**
 * Account statement: deposits, withdrawals and trades in one export.
 *
 * Rows are assembled from three tables because the app deliberately keeps them
 * separate (the `TransactionType` enum has no WITHDRAWAL member, and a crypto
 * deposit is tracked from charge creation through on-chain confirmation):
 *
 *   - `Transaction`            BUY / SELL / DEPOSIT
 *   - `WithdrawalRequest`      WITHDRAWAL
 *   - `CryptoDeposit`          only deposits not yet reflected above
 *
 * `Asset` is the instrument for a trade and the currency/coin for cash movements.
 * `Amount` is an unsigned magnitude (direction lives in `Type`): a trade's
 * amount is the notional, which is not a cash flow, so a signed summing column
 * would be misleading.
 */

export type StatementType = "DEPOSIT" | "WITHDRAWAL" | "BUY" | "SELL";

export type StatementRow = {
  date: Date;
  type: StatementType;
  asset: string;
  /** Unsigned money value; null where not applicable. */
  amount: number | null;
  /** Per-unit price; null for cash movements. */
  price: number | null;
  /** Normalised uppercase status, e.g. FILLED, COMPLETED, PENDING. */
  status: string;
};

/**
 * Broker/deposit statuses arrive in mixed case (`filled`, `completed`,
 * `waiting`); uppercasing gives the column a single vocabulary.
 */
const upper = (value: string): string => value.trim().toUpperCase() || "UNKNOWN";

/**
 * Trim float artifacts (0.30000000000000004) without losing real precision.
 *
 * Exported so the rounding rules can be tested directly — `toCsv` deliberately
 * renders values verbatim, so these are the only place precision is decided.
 */
export const roundMoney = (value: number): number => Number(value.toFixed(2));

/**
 * Per-unit price, kept at 8 decimals: 6 would round a crypto price of
 * 0.00001234 down to 0.000012, quietly misstating the fill. `Number` then
 * strips the trailing zeros, so an equity still writes as `332.25`.
 */
export const roundPrice = (value: number): number => Number(value.toFixed(8));

/** Status used for a trade we logged but whose broker row we cannot find. */
const LOGGED_STATUS = "RECORDED";

/**
 * Build every statement row for a user, newest first.
 *
 * Deposits are read from `Transaction`, which is the authoritative cash ledger.
 * A `CryptoDeposit` is emitted only when it has not already been credited —
 * matched on `transactionId` *and* on the credit reference, because the webhook
 * writes those in two separate statements: a failure (or a replayed webhook that
 * hits the unique-reference guard) can leave `transactionId` null while the
 * `Transaction` already exists, and including both would double-count the money.
 */
export async function buildStatement(userId: string): Promise<StatementRow[]> {
  const [transactions, withdrawals, unsettledDeposits, orders] = await Promise.all([
    prisma.transaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        type: true,
        symbol: true,
        shares: true,
        price: true,
        amount: true,
        currency: true,
        reference: true,
        createdAt: true,
      },
    }),
    prisma.withdrawalRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { asset: true, amountUsd: true, status: true, createdAt: true },
    }),
    prisma.cryptoDeposit.findMany({
      where: { userId, transactionId: null },
      select: {
        asset: true,
        amountUsd: true,
        status: true,
        providerId: true,
        createdAt: true,
      },
    }),
    prisma.order.findMany({
      where: { userId },
      select: { providerId: true, status: true },
    }),
  ]);

  // Broker status for a trade, keyed on the Alpaca order id (shared with the
  // transaction's `reference`). The type arguments are explicit so the value
  // stays `string` (not `unknown`) when this module is staged with a stubbed
  // `prisma` in the unit-test harness.
  const orderStatus = new Map<string, string>(
    orders.map((order) => [order.providerId, order.status]),
  );

  // References already credited, so a settled crypto deposit is emitted once.
  const credited = new Set(
    transactions
      .filter((row) => row.type === "DEPOSIT")
      .map((row) => row.reference)
      .filter((reference): reference is string => Boolean(reference)),
  );

  const rows: StatementRow[] = transactions.map((row) => {
    if (row.type === "DEPOSIT") {
      return {
        date: row.createdAt,
        type: "DEPOSIT",
        // The credit is denominated in `currency` (USD for a crypto charge).
        asset: row.currency ?? "USD",
        amount: row.amount === null ? null : roundMoney(row.amount),
        price: null,
        status: "COMPLETED",
      };
    }

    // A filled order contributes its fill price and quantity. A queued order
    // has neither, and records the pre-submit quote instead — so if no fill and
    // no quote are known these cells stay empty rather than asserting $0.00.
    const notional =
      row.shares > 0 && row.price > 0 ? roundMoney(row.shares * row.price) : null;
    const unitPrice = row.price > 0 ? roundPrice(row.price) : null;
    const status = row.reference ? orderStatus.get(row.reference) : undefined;

    return {
      date: row.createdAt,
      type: row.type === "SELL" ? "SELL" : "BUY",
      asset: row.symbol ?? "",
      amount: notional,
      price: unitPrice,
      status: upper(status ?? LOGGED_STATUS),
    };
  });

  for (const deposit of unsettledDeposits) {
    // The webhook credits under `nowpayments:${paymentId}` and persists
    // `providerId` from that same `paymentId`, so the provider id is the key
    // that ties an unsettled row back to an already-recorded Transaction. This
    // catches the two cases `transactionId` misses: the gap between crediting
    // and writing the pointer, and a replayed webhook whose unique-reference
    // guard leaves `transactionId` null permanently.
    const reference = deposit.providerId
      ? `nowpayments:${deposit.providerId}`
      : null;
    if (reference && credited.has(reference)) continue;

    rows.push({
      date: deposit.createdAt,
      type: "DEPOSIT",
      asset: deposit.asset,
      amount: roundMoney(deposit.amountUsd),
      price: null,
      status: upper(deposit.status),
    });
  }

  for (const withdrawal of withdrawals) {
    rows.push({
      date: withdrawal.createdAt,
      type: "WITHDRAWAL",
      asset: withdrawal.asset,
      amount: roundMoney(withdrawal.amountUsd),
      price: null,
      status: upper(withdrawal.status),
    });
  }

  rows.sort((a, b) => b.date.getTime() - a.date.getTime());
  return rows;
}

/* ---------------------------------- CSV ---------------------------------- */

const CSV_COLUMNS = ["Date", "Type", "Asset", "Amount", "Price", "Status"] as const;

/**
 * Quote a cell per RFC 4180 — only when it contains a delimiter, quote or line
 * break, so ordinary values stay readable in a plain-text diff.
 */
function escapeCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Render statement rows as CSV.
 *
 * Values are written raw rather than locale-formatted (no `$`, no thousands
 * separators) so spreadsheet numeric columns parse as numbers.
 *
 * Rows with no value emit an empty cell instead of `0`, which keeps the column
 * numeric and makes "not applicable" distinguishable from a real zero.
 */
export function toCsv(rows: readonly StatementRow[]): string {
  const lines = [CSV_COLUMNS.join(",")];

  for (const row of rows) {
    lines.push(
      [
        row.date.toISOString(),
        row.type,
        escapeCell(row.asset),
        row.amount === null ? "" : String(row.amount),
        row.price === null ? "" : String(row.price),
        escapeCell(row.status),
      ].join(","),
    );
  }

  // Trailing newline: many tools misread the final record without one.
  return `${lines.join("\r\n")}\r\n`;
}

/** Filename for a statement download, e.g. `bulkinvest-statement-2026-10-06.csv`. */
export function statementFilename(on: Date = new Date()): string {
  return `bulkinvest-statement-${on.toISOString().slice(0, 10)}.csv`;
}