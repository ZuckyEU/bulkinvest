import { prisma } from "@/lib/prisma";
import { CRYPTO_ASSETS, type CryptoAsset } from "@/lib/crypto-payments";

/**
 * Crypto withdrawal requests.
 *
 * This is a request queue, not a payout engine: submitting a request records
 * the user's intent with status PENDING and moves no funds. Nothing here calls
 * the broker, debits a balance, or signs a transaction — an operator settles
 * requests out of band and flips the status to COMPLETED or REJECTED.
 */

export const WITHDRAWAL_STATUS_PENDING = "PENDING";
export const WITHDRAWAL_STATUS_COMPLETED = "COMPLETED";
export const WITHDRAWAL_STATUS_REJECTED = "REJECTED";

/** Below this a network fee would eat the transfer, so it is not accepted. */
export const MIN_WITHDRAWAL_USD = 10;
export const MAX_WITHDRAWAL_USD = 100_000;

export class WithdrawalError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "WITHDRAWAL_ERROR") {
    super(message);
    this.name = "WithdrawalError";
    this.status = status;
    this.code = code;
  }
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function parseWithdrawalAmount(raw: unknown): number {
  const amount =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw)
        : Number.NaN;

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new WithdrawalError(
      "Enter an amount greater than zero.",
      400,
      "INVALID_AMOUNT",
    );
  }

  const rounded = roundMoney(amount);

  if (rounded < MIN_WITHDRAWAL_USD) {
    throw new WithdrawalError(
      `The minimum withdrawal is $${MIN_WITHDRAWAL_USD}.`,
      400,
      "AMOUNT_TOO_SMALL",
    );
  }

  if (rounded > MAX_WITHDRAWAL_USD) {
    throw new WithdrawalError(
      `The maximum withdrawal is $${MAX_WITHDRAWAL_USD.toLocaleString("en-US")}.`,
      400,
      "AMOUNT_TOO_LARGE",
    );
  }

  return rounded;
}

/**
 * Validate a destination address for the chosen asset.
 *
 * These are shape checks (length + character set), not checksum validation:
 * they catch typos and pasted garbage early, while deliberately never claiming
 * an address is "valid" in a way that could lose funds. The user is always told
 * to double-check before submitting.
 */
export function parseDestinationAddress(raw: unknown, asset: CryptoAsset): string {
  const address = typeof raw === "string" ? raw.trim() : "";

  if (!address) {
    throw new WithdrawalError("Enter a destination wallet address.", 400, "ADDRESS_REQUIRED");
  }

  if (address.length < 12 || address.length > 120) {
    throw new WithdrawalError(
      `That does not look like a ${asset.asset} address.`,
      400,
      "ADDRESS_INVALID",
    );
  }

  if (/\s/.test(address)) {
    throw new WithdrawalError(
      "A wallet address cannot contain spaces.",
      400,
      "ADDRESS_INVALID",
    );
  }

  // Network-specific shape checks.
  if (asset.payCurrency === "btc" && !/^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address)) {
    throw new WithdrawalError(
      "Bitcoin addresses start with 1 or 3 and are 26-35 characters long.",
      400,
      "ADDRESS_INVALID",
    );
  }

  if (asset.payCurrency === "eth" && !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new WithdrawalError(
      "Ethereum addresses start with 0x followed by 40 hex characters.",
      400,
      "ADDRESS_INVALID",
    );
  }

  if (asset.payCurrency === "usdttrc20" && !/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) {
    throw new WithdrawalError(
      "TRON (TRC20) addresses start with T and are 34 characters long.",
      400,
      "ADDRESS_INVALID",
    );
  }

  return address;
}

export function parseWithdrawalAsset(raw: unknown): CryptoAsset {
  const asset = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  const match = CRYPTO_ASSETS.find((entry) => entry.asset === asset);

  if (!match) {
    throw new WithdrawalError("Choose a supported asset.", 400, "ASSET_UNSUPPORTED");
  }

  return match;
}

/**
 * A short, human-readable ticket id, e.g. WD-8F3K2Q.
 *
 * Uniqueness is enforced by the DB's unique index on `reference`; the random
 * suffix makes a collision unlikely enough to retry rather than handle.
 */
function makeReference(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `WD-${suffix}`;
}

export type WithdrawalRequestInput = {
  userId: string;
  asset: string;
  amountUsd: number;
  address: string;
};

export type WithdrawalRequestDTO = {
  id: string;
  reference: string;
  asset: string;
  network: string;
  amountUsd: number;
  address: string;
  status: string;
  createdAt: string;
};

/** Record a withdrawal request. Does not move any funds. */
export async function createWithdrawalRequest(
  input: WithdrawalRequestInput,
): Promise<WithdrawalRequestDTO> {
  const asset = parseWithdrawalAsset(input.asset);
  const amountUsd = parseWithdrawalAmount(input.amountUsd);
  const address = parseDestinationAddress(input.address, asset);

  // Retry a couple of times in the (very unlikely) event of a reference clash.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const row = await prisma.withdrawalRequest.create({
        data: {
          userId: input.userId,
          asset: asset.asset,
          network: asset.network,
          amountUsd,
          address,
          reference: makeReference(),
          status: WITHDRAWAL_STATUS_PENDING,
        },
      });

      return {
        id: row.id,
        reference: row.reference,
        asset: row.asset,
        network: row.network,
        amountUsd: row.amountUsd,
        address: row.address,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (error) {
      const isUniqueClash =
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "P2002";
      if (isUniqueClash) continue;
      throw error;
    }
  }

  throw new WithdrawalError(
    "Could not allocate a reference for this request. Please try again.",
    500,
    "REFERENCE_EXHAUSTED",
  );
}

/** Newest-first withdrawal requests for an account. */
export async function getWithdrawalRequests(
  userId: string,
  take = 25,
): Promise<WithdrawalRequestDTO[]> {
  const rows = await prisma.withdrawalRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });

  return rows.map((row) => ({
    id: row.id,
    reference: row.reference,
    asset: row.asset,
    network: row.network,
    amountUsd: row.amountUsd,
    address: row.address,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}