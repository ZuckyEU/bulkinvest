import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

/**
 * GET /api/payments/crypto/status?id=<depositId>
 *
 * Returns the local state of a crypto deposit so the modal can show the
 * address, the amount due, and poll for confirmation. Omit `id` to list the
 * user's recent deposits.
 *
 * 200 deposit(s) | 401 not signed in | 404 unknown deposit
 */
export const dynamic = "force-dynamic";

function serialize(deposit: {
  id: string;
  asset: string;
  network: string | null;
  payCurrency: string;
  amountUsd: number;
  payAmount: number | null;
  payAddress: string | null;
  status: string;
  txHash: string | null;
  transactionId: string | null;
  createdAt: Date;
}) {
  return {
    depositId: deposit.id,
    asset: deposit.asset,
    network: deposit.network,
    payCurrency: deposit.payCurrency,
    amountUsd: deposit.amountUsd,
    payAmount: deposit.payAmount,
    payAddress: deposit.payAddress,
    status: deposit.status,
    txHash: deposit.txHash,
    credited: deposit.transactionId !== null,
    createdAt: deposit.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  const id = new URL(request.url).searchParams.get("id");

  if (!id) {
    const recent = await prisma.cryptoDeposit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 5,
    });
    return NextResponse.json(
      { deposits: recent.map(serialize) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const deposit = await prisma.cryptoDeposit.findFirst({
    where: { id, userId: user.id },
  });

  if (!deposit) {
    return NextResponse.json(
      { error: "Crypto deposit not found.", code: "NOT_FOUND" },
      { status: 404 },
    );
  }

  return NextResponse.json(serialize(deposit), {
    headers: { "Cache-Control": "no-store" },
  });
}
