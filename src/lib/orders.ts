import { prisma } from "@/lib/prisma";
import type { PlacedOrder } from "@/lib/alpaca";
import { getOpenAlpacaOrders } from "@/lib/alpaca";
import type { PendingOrder } from "@/lib/portfolio-types";

/**
 * Local order tracking.
 *
 * Alpaca owns positions, but an order that has been accepted and not yet filled
 * (e.g. placed outside market hours) produces no position — so the broker alone
 * cannot show the user that something is pending. These rows mirror the broker
 * order so the dashboard and the fallback holdings endpoint can surface it.
 *
 * Rows are keyed on the Alpaca order id, so a retry cannot double-record.
 */

/** Statuses that mean "accepted but not yet filled". */
export const PENDING_ORDER_STATUSES = [
  "new",
  "accepted",
  "pending_new",
  "accepted_for_bidding",
  "held",
  "queued",
  "partially_filled",
] as const;

export type OrderRecord = {
  id: string;
  providerId: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  notional: number | null;
  limitPrice: number | null;
  status: string;
  filledQty: number;
  filledAvgPrice: number;
  referencePrice: number | null;
  assetClass: string | null;
  submittedAt: Date;
};

export async function recordOrder(
  userId: string,
  order: PlacedOrder,
  extra: { referencePrice?: number | null; limitPrice?: number | null } = {},
): Promise<void> {
  const providerId = order.id ?? order.clientOrderId;
  if (!providerId) return;

  const data = {
    userId,
    provider: "alpaca",
    providerId,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    qty: order.qty,
    notional: order.notional,
    limitPrice: extra.limitPrice ?? null,
    status: order.status ?? "new",
    filledQty: order.filledQty,
    filledAvgPrice: order.filledAvgPrice,
    referencePrice: extra.referencePrice ?? null,
    assetClass: order.assetClass,
  };

  try {
    await prisma.order.upsert({
      where: { providerId },
      create: data,
      update: {
        status: data.status,
        filledQty: data.filledQty,
        filledAvgPrice: data.filledAvgPrice,
        limitPrice: data.limitPrice,
        referencePrice: data.referencePrice,
      },
    });
  } catch (error) {
    console.error("Could not record the order locally:", error);
  }
}

/** Orders that are accepted but not yet filled, newest first. */
export async function getPendingOrders(userId: string): Promise<OrderRecord[]> {
  return prisma.order.findMany({
    where: {
      userId,
      status: { in: [...PENDING_ORDER_STATUSES] },
      // A partially-filled order has a position too; still worth showing.
    },
    orderBy: { submittedAt: "desc" },
    take: 25,
  });
}

function toDTO(row: OrderRecord): PendingOrder {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    type: row.type,
    qty: row.qty,
    notional: row.notional,
    limitPrice: row.limitPrice,
    status: row.status,
    referencePrice: row.referencePrice,
    assetClass: row.assetClass,
    submittedAt: row.submittedAt.toISOString(),
  };
}

/**
 * Pending orders for a user, reconciled against the broker.
 *
 * The local table is authoritative when the broker is unreachable, but when the
 * broker responds we trust it: orders it no longer lists have filled or been
 * cancelled, so they must stop showing as pending.
 */
export async function getPendingOrderDTOs(userId: string): Promise<PendingOrder[]> {
  const rows = await getPendingOrders(userId);

  let brokerOpen: Awaited<ReturnType<typeof getOpenAlpacaOrders>> | null = null;
  try {
    brokerOpen = await getOpenAlpacaOrders();
  } catch (error) {
    console.warn("Could not list open broker orders; using local order rows:", error);
  }

  // Broker unreachable: the local rows are the best information available.
  if (brokerOpen === null) {
    return rows.map(toDTO);
  }

  const byId = new Map(
    brokerOpen
      .filter((order) => Boolean(order.id))
      .map((order) => [order.id as string, order]),
  );

  const reconciled: PendingOrder[] = [];
  for (const row of rows) {
    const broker = row.providerId ? byId.get(row.providerId) : undefined;

    if (!broker) {
      // No longer working at the broker (filled or cancelled): retire the row.
      await prisma.order
        .update({ where: { id: row.id }, data: { status: "closed" } })
        .catch(() => undefined);
      continue;
    }

    const nextStatus = broker.status ?? row.status;
    if (nextStatus !== row.status) {
      await prisma.order
        .update({
          where: { id: row.id },
          data: {
            status: nextStatus,
            filledQty: broker.filledQty ?? row.filledQty,
            filledAvgPrice: broker.filledAvgPrice ?? row.filledAvgPrice,
          },
        })
        .catch(() => undefined);
    }

    reconciled.push({ ...toDTO(row), status: nextStatus });
  }

  // Orders the broker is working that we have no local row for.
  const knownProviderIds = new Set(
    rows.map((row) => row.providerId).filter((id): id is string => Boolean(id)),
  );
  const brokerOnly: PendingOrder[] = brokerOpen
    .filter((order) => order.id && !knownProviderIds.has(order.id))
    .map((order) => ({
      id: order.id as string,
      symbol: order.symbol ?? "—",
      side: order.side ?? "buy",
      type: order.type ?? "market",
      qty: order.qty ?? 0,
      notional: order.notional,
      limitPrice: order.limitPrice,
      status: order.status ?? "accepted",
      referencePrice: null,
      assetClass: order.assetClass,
      submittedAt: order.submittedAt ?? new Date().toISOString(),
    }));

  return [...reconciled, ...brokerOnly].sort(
    (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
}
