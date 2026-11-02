import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { convertToUsd } from "@/lib/fx";

/**
 * Deposits: the only way cash enters an account.
 *
 * A deposit is recorded as a `Transaction` of type DEPOSIT. The provider
 * reference is unique, which makes crediting idempotent — a replayed webhook
 * cannot pay a user twice.
 */

export const PAYMENT_PROVIDER_STRIPE = "stripe";
export const PAYMENT_PROVIDER_NOWPAYMENTS = "nowpayments";
/** The pre-deposits $100,000 grant, backfilled for accounts created earlier. */
export const PAYMENT_PROVIDER_LEGACY = "legacy-grant";

export const MIN_DEPOSIT = 5;
export const MAX_DEPOSIT = 100_000;
export const DEFAULT_CURRENCY = "USD";

export class DepositError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "DEPOSIT_ERROR") {
    super(message);
    this.name = "DepositError";
    this.status = status;
    this.code = code;
  }
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Validate and normalise a user-entered amount (major units). */
export function parseDepositAmount(raw: unknown): number {
  const amount =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DepositError("Enter a deposit amount greater than zero.", 400, "INVALID_AMOUNT");
  }

  const rounded = roundMoney(amount);

  if (rounded < MIN_DEPOSIT) {
    throw new DepositError(
      `The minimum deposit is $${MIN_DEPOSIT}.`,
      400,
      "AMOUNT_TOO_SMALL",
    );
  }

  if (rounded > MAX_DEPOSIT) {
    throw new DepositError(
      `The maximum deposit is $${MAX_DEPOSIT.toLocaleString("en-US")}.`,
      400,
      "AMOUNT_TOO_LARGE",
    );
  }

  return rounded;
}

export function parseCurrency(raw: unknown): string {
  const code =
    typeof raw === "string" && raw.trim() !== "" ? raw.trim().toUpperCase() : DEFAULT_CURRENCY;
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new DepositError("Unsupported currency.", 400, "INVALID_CURRENCY");
  }
  return code;
}

export type DepositInput = {
  userId: string;
  /** Amount in `currency`, major units. */
  amount: number;
  currency: string;
  provider: string;
  /** Provider reference; also the idempotency key. */
  reference: string;
  /** On-chain transaction hash, for crypto deposits. */
  txHash?: string | null;
};

export type CreditResult = {
  /** False when this reference was already credited. */
  credited: boolean;
  amount: number;
  currency: string;
  cashBalance: number;
  transactionId: string;
};

/**
 * Credit a verified payment to the user's balance, exactly once.
 *
 * The unique index on `Transaction.reference` is the source of truth: if two
 * webhooks race, one insert wins and the other is rejected (rolling back its
 * balance increment too).
 */
export async function creditDeposit(input: DepositInput): Promise<CreditResult> {
  const amount = roundMoney(input.amount);
  const currency = parseCurrency(input.currency);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new DepositError("Deposit amount must be positive.", 400, "INVALID_AMOUNT");
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.transaction.findUnique({
        where: { reference: input.reference },
        select: { id: true, amount: true, currency: true, userId: true },
      });

      if (existing) {
        // Guard against a reference being replayed onto a different account.
        if (existing.userId !== input.userId) {
          throw new DepositError(
            "This payment reference belongs to another account.",
            409,
            "REFERENCE_CONFLICT",
          );
        }

        const user = await tx.user.findUniqueOrThrow({
          where: { id: input.userId },
          select: { cashBalance: true },
        });

        return {
          credited: false,
          amount: existing.amount ?? 0,
          currency: existing.currency ?? currency,
          cashBalance: roundMoney(user.cashBalance),
          transactionId: existing.id,
        };
      }

      const transaction = await tx.transaction.create({
        data: {
          userId: input.userId,
          type: "DEPOSIT",
          symbol: null,
          shares: 0,
          price: 0,
          amount,
          currency,
          provider: input.provider,
          reference: input.reference,
          txHash: input.txHash ?? null,
        },
        select: { id: true },
      });

      const user = await tx.user.update({
        where: { id: input.userId },
        data: { cashBalance: { increment: amount } },
        select: { cashBalance: true },
      });

      return {
        credited: true,
        amount,
        currency,
        cashBalance: roundMoney(user.cashBalance),
        transactionId: transaction.id,
      };
    });
  } catch (error) {
    // Lost the unique-reference race: the other request already credited it.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const user = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { cashBalance: true },
      });
      return {
        credited: false,
        amount,
        currency,
        cashBalance: roundMoney(user?.cashBalance ?? 0),
        transactionId: "",
      };
    }

    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2025"
    ) {
      throw new DepositError("Account not found.", 404, "USER_NOT_FOUND");
    }

    throw error;
  }
}

/** Newest-first deposit records for an account. */
export async function getDeposits(userId: string, take = 25) {
  return prisma.transaction.findMany({
    where: { userId, type: "DEPOSIT" },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** Total deposited, converted to USD. */
export async function getDepositsUsdTotal(userId: string): Promise<number> {
  const rows = await prisma.transaction.findMany({
    where: { userId, type: "DEPOSIT" },
    select: { amount: true, currency: true },
  });

  let total = 0;
  for (const row of rows) {
    total += await convertToUsd(row.amount ?? 0, row.currency ?? DEFAULT_CURRENCY);
  }
  return roundMoney(total);
}
