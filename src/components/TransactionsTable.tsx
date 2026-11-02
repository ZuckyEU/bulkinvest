import { formatDateTime, formatShares, formatUSD } from "@/lib/format";
import {
  isDepositTransaction,
  transactionTotal,
} from "@/lib/transactions";
import type { Transaction } from "@prisma/client";

type TransactionsTableProps = {
  transactions: Transaction[];
  total: number;
  className?: string;
};

const TYPE_STYLES: Record<string, string> = {
  BUY: "bg-sky-400/10 text-sky-400",
  SELL: "bg-violet-400/10 text-violet-300",
  DEPOSIT: "bg-emerald-400/10 text-emerald-400",
};

/**
 * Log of deposits and executed trades, newest first.
 *
 * Deposits have no instrument, so the Ticker/Shares/Price columns show an
 * em dash and the funded amount appears under Total Amount.
 *
 * Server component: the rows are already loaded by the caller.
 */
export function TransactionsTable({
  transactions,
  total,
  className = "",
}: TransactionsTableProps) {
  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    >
      <div className="flex items-center justify-between px-6 py-5">
        <h2 className="text-lg font-semibold text-white">Account activity</h2>
        <span className="text-xs text-slate-500">
          {total} {total === 1 ? "entry" : "entries"}
        </span>
      </div>

      {transactions.length === 0 ? (
        <div className="border-t border-white/5 px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-400">No activity yet</p>
          <p className="mt-1 text-xs text-slate-600">
            Add funds or place an order and it will be logged here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-t border-white/5 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3 text-left font-medium">Date</th>
                <th className="px-3 py-3 text-left font-medium">Ticker</th>
                <th className="px-3 py-3 text-left font-medium">Type</th>
                <th className="px-3 py-3 text-right font-medium">Shares</th>
                <th className="px-3 py-3 text-right font-medium">Price</th>
                <th className="px-6 py-3 text-right font-medium">
                  Total Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((transaction) => {
                const isDeposit = isDepositTransaction(transaction);
                const total = transactionTotal(transaction);

                return (
                  <tr
                    key={transaction.id}
                    className="border-t border-white/5 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="whitespace-nowrap px-6 py-4 text-slate-400">
                      {formatDateTime(transaction.createdAt.toISOString())}
                    </td>

                    <td className="px-3 py-4">
                      {isDeposit ? (
                        <span className="text-xs text-slate-500">
                          {transaction.provider ?? "Deposit"}
                        </span>
                      ) : (
                        <span className="grid h-8 w-16 place-items-center rounded-lg bg-white/5 font-mono text-xs font-semibold text-slate-200">
                          {transaction.symbol}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-4">
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          TYPE_STYLES[transaction.type] ??
                          "bg-white/5 text-slate-300"
                        }`}
                      >
                        {transaction.type}
                      </span>
                    </td>

                    <td className="px-3 py-4 text-right font-mono text-slate-300">
                      {isDeposit ? "—" : formatShares(transaction.shares)}
                    </td>

                    <td className="px-3 py-4 text-right text-slate-300">
                      {isDeposit ? "—" : formatUSD(transaction.price)}
                    </td>

                    <td
                      className={`px-6 py-4 text-right font-medium ${
                        isDeposit ? "text-emerald-400" : "text-white"
                      }`}
                    >
                      {isDeposit ? "+" : ""}
                      {formatUSD(total)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
