/**
 * Account tiers and their daily limits.
 *
 * Kept in its own module with no imports so it can be shared by server code
 * and client components alike — importing the verification helpers into a
 * browser component would drag Prisma into the client bundle.
 *
 * Verification is deliberately lightweight (a confirmed email address, no
 * document upload), and the tier that unlocks is what these limits describe.
 */

export const ACCOUNT_LIMITS = {
  /** Daily limit before the email address is confirmed. */
  unverified: 1_000,
  /** Daily limit once confirmed. */
  verified: 50_000,
} as const;

export type VerificationTier = keyof typeof ACCOUNT_LIMITS;

export function tierFor(isVerified: boolean): VerificationTier {
  return isVerified ? "verified" : "unverified";
}

/** Formats a limit as e.g. "$1,000" / "$50,000". */
export function formatDailyLimit(limit: number): string {
  return `$${limit.toLocaleString("en-US")}`;
}