import { prisma } from "@/lib/prisma";
import type { Transaction } from "@prisma/client";
import type { AccountSummary } from "@/lib/account-types";

/**
 * Account reads, always scoped to a single authenticated user.
 *
 * There is no "current user" lookup here on purpose: callers resolve the id
 * from the Auth.js session and pass it in, which keeps every query tied to the
 * session and makes it obvious that one account can never read another's rows.
 */

/** The signed-in user's cash, holdings and profile, or null if the id is unknown. */
export async function getAccountForUser(
  userId: string,
): Promise<AccountSummary | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      cashBalance: true,
      holdings: {
        select: { symbol: true, shares: true, avgPrice: true },
        orderBy: { symbol: "asc" as const },
      },
    },
  });
}

/** Most recent trades for the activity feed. */
export async function getRecentTransactions(userId: string, take = 6) {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export type TransactionPage = {
  transactions: Transaction[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * One page of executed trades, newest first.
 *
 * The requested page is clamped to the available range so an out-of-range
 * `?page=` renders the last page instead of an empty table.
 */
export async function getTransactionPage(
  userId: string,
  requestedPage = 1,
  pageSize = 25,
): Promise<TransactionPage> {
  const total = await prisma.transaction.count({ where: { userId } });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(
    Math.max(1, Math.floor(requestedPage) || 1),
    totalPages,
  );

  const transactions = await prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  return { transactions, total, page, pageSize, totalPages };
}
