import { AppShell } from "@/components/AppShell";
import { TransactionsTable } from "@/components/TransactionsTable";
import { getAccountForUser, getTransactionPage } from "@/lib/account";
import { getSessionUser } from "@/lib/session";
import { redirect } from "next/navigation";

export const metadata = {
  title: "Transaction history — BulkInvest",
  description: "Every executed paper trade, newest first.",
};

// Reads the session and the database on each request.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type HistoryPageProps = {
  searchParams: { page?: string };
};

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const account = await getAccountForUser(user.id);
  if (!account) redirect("/login");

  const requested = Number.parseInt(searchParams.page ?? "1", 10);
  const result = await getTransactionPage(account.id, requested, PAGE_SIZE);

  const firstRow = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const lastRow = Math.min(result.page * result.pageSize, result.total);

  return (
    <AppShell
      active="History"
      title="Transaction history"
      description="Every executed paper trade, newest first"
    >
      <TransactionsTable
        transactions={result.transactions}
        total={result.total}
      />

      {result.total > result.pageSize ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-slate-500">
            Showing {firstRow}–{lastRow} of {result.total}
          </p>

          <div className="flex items-center gap-2">
            {result.page > 1 ? (
              <a
                href={`/history?page=${result.page - 1}`}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10"
              >
                Previous
              </a>
            ) : (
              <span className="rounded-full border border-white/5 px-4 py-2 text-xs font-medium text-slate-600">
                Previous
              </span>
            )}

            <span className="px-1 text-xs text-slate-500">
              Page {result.page} of {result.totalPages}
            </span>

            {result.page < result.totalPages ? (
              <a
                href={`/history?page=${result.page + 1}`}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/10"
              >
                Next
              </a>
            ) : (
              <span className="rounded-full border border-white/5 px-4 py-2 text-xs font-medium text-slate-600">
                Next
              </span>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
