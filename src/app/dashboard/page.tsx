import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { DepositButton } from "@/components/DepositButton";
import { WithdrawButton } from "@/components/WithdrawButton";
import { LivePortfolio } from "@/components/LivePortfolio";
import { AlpacaPortfolio } from "@/components/AlpacaPortfolio";
import { getAccountForUser, getRecentTransactions } from "@/lib/account";
import { getDepositsUsdTotal } from "@/lib/deposits";
import { getSessionUser } from "@/lib/session";
import { formatDate, formatUSD } from "@/lib/format";
import { isDepositTransaction, transactionTotal } from "@/lib/transactions";
import { getQuotes } from "@/lib/stocks";
import { getPortfolioSnapshot, isAlpacaConfigured } from "@/lib/alpaca";
import { getPendingOrderDTOs } from "@/lib/orders";
import type { QuoteMap } from "@/lib/live";
import type { PortfolioSnapshot } from "@/lib/portfolio-types";

export const metadata = {
  title: "Dashboard — BulkInvest",
  description: "Track your portfolio value, buying power and profit.",
};

// Values come from the database and the broker, so this must not be
// prerendered at build time.
export const dynamic = "force-dynamic";

type DashboardPageProps = {
  searchParams: { deposit?: string };
};

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const account = await getAccountForUser(user.id);
  // A valid session pointing at a deleted account: force a fresh sign-in.
  if (!account) redirect("/login");

  const transactions = await getRecentTransactions(account.id, 6);

  // Alpaca is the source of truth when configured. If it is unreachable we fall
  // back to the local ledger rather than breaking the page.
  let snapshot: PortfolioSnapshot | null = null;
  let brokerError: string | null = null;
  if (isAlpacaConfigured()) {
    try {
      const pendingOrders = await getPendingOrderDTOs(user.id);
      snapshot = await getPortfolioSnapshot({ pendingOrders });
    } catch (error) {
      brokerError =
        error instanceof Error ? error.message : "Could not reach the trading service.";
      console.error("Alpaca snapshot failed on the dashboard:", error);
    }
  }

  // Local fallback (only fetched when the broker snapshot is unavailable).
  const initialQuotes: QuoteMap = {};
  let deposits = 0;
  if (!snapshot) {
    const [quoteResult, depositsTotal] = await Promise.all([      getQuotes(account.holdings.map((holding) => holding.symbol)),
      getDepositsUsdTotal(account.id),
    ]);
    for (const quote of quoteResult.quotes) {
      initialQuotes[quote.symbol] = {
        price: quote.price,
        change: quote.change,
        changePercent: quote.changePercent,
      };
    }
    deposits = depositsTotal;
  }

  // "Brand new" is about the user's own ledger: $0 deposited and nothing held.
  const isBrandNew =
    account.cashBalance === 0 &&
    (snapshot ? snapshot.positions.length === 0 : account.holdings.length === 0);

  const depositNotice =
    searchParams.deposit === "success"
      ? {
          tone: "ok" as const,
          text: "Payment received. Your balance will update as soon as the payment is confirmed.",
        }
      : searchParams.deposit === "cancelled"
        ? {
            tone: "warn" as const,
            text: "Checkout cancelled — no funds were added.",
          }
        : null;

  return (
    <AppShell
      active="Dashboard"
      title="Portfolio overview"
      description="Auto-refreshes every 30 seconds"
      actions={
        <>
          <Link
            href="/markets"
            className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
          >
            Research
          </Link>
          <WithdrawButton />
          <DepositButton depositStatus={searchParams.deposit} />
        </>
      }
    >
      {depositNotice ? (
        <p
          className={`mb-6 rounded-xl border p-3 text-sm ${
            depositNotice.tone === "ok"
              ? "border-emerald-400/20 bg-emerald-400/[0.06] text-emerald-300"
              : "border-amber-400/20 bg-amber-400/[0.06] text-amber-300"
          }`}
        >
          {depositNotice.text}
        </p>
      ) : null}

      {brokerError ? (
        <p className="mb-6 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-sm text-amber-300">
          The trading service is unavailable ({brokerError}). Showing your saved
          holdings instead — live values will resume when the connection recovers.
        </p>
      ) : null}

      {isBrandNew ? (
        <section className="mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.05] p-6">
          <h2 className="text-lg font-semibold text-white">Fund your account</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            Add funds or deposit crypto, then buy your first position from the
            Markets page — it will appear here.
          </p>
          <div className="mt-4">
            <DepositButton />
          </div>
        </section>
      ) : null}

      {snapshot ? (
        <AlpacaPortfolio
          initialSnapshot={snapshot}
          localCash={account.cashBalance}
        />
      ) : (
        <LivePortfolio
          account={account}
          deposits={deposits}
          initialQuotes={initialQuotes}
        />
      )}

      {/* Recent activity */}
      <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] lg:col-span-3">
          <div className="flex items-center justify-between px-6 py-5">
            <h2 className="text-lg font-semibold text-white">Recent activity</h2>
            <a href="/history" className="text-xs text-emerald-400 hover:underline">
              View all
            </a>
          </div>

          {transactions.length === 0 ? (
            <div className="border-t border-white/5 px-6 py-16 text-center">
              <p className="text-sm font-medium text-slate-400">No activity yet</p>
              <p className="mt-1 text-xs text-slate-600">
                Your deposits and filled orders will show up here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-white/5 border-t border-white/5 px-6">
              {transactions.map((transaction) => {
                const isDeposit = isDepositTransaction(transaction);
                const isBuy = transaction.type === "BUY";

                return (
                  <li
                    key={transaction.id}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`rounded-md px-2 py-1 text-xs font-semibold ${
                          isDeposit
                            ? "bg-emerald-400/10 text-emerald-400"
                            : isBuy
                              ? "bg-sky-400/10 text-sky-400"
                              : "bg-violet-400/10 text-violet-300"
                        }`}
                      >
                        {transaction.type}
                      </span>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {isDeposit
                            ? (transaction.provider ?? "Deposit")
                            : transaction.symbol}
                        </p>
                        <p className="text-xs text-slate-500">
                          {isDeposit
                            ? (transaction.currency ?? "USD")
                            : `${transaction.shares} units at ${formatUSD(
                                transaction.price,
                              )}`}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-300">
                        {formatUSD(transactionTotal(transaction))}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatDate(transaction.createdAt.toISOString())}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
