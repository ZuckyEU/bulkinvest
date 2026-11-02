import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Email verification for the account tier.
 *
 * There is deliberately no KYC document upload and no third-party identity
 * check — this is a lightweight confirmation that the address the user signed
 * up with can be reached.
 *
 * The flow is a single-use token with a fixed lifetime:
 *
 *   1. `issueVerificationToken` mints and stores a token for the account.
 *   2. The token is delivered as a URL (see /api/user/verify-email).
 *   3. Opening that URL calls `confirmVerificationToken`, which flips
 *      `isEmailVerified` and clears the token so it cannot be replayed.
 *
 * No mail transport is configured in this codebase, so step 2 currently hands
 * the link back to the caller for display rather than pretending an email was
 * sent. See `NO_MAIL_PROVIDER` in the route.
 */

/** Confirmation links must be used within this window. */
export const VERIFICATION_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Daily account limits by verification tier.
 *
 * Defined in its own dependency-free module so client components can render
 * them without pulling Prisma into the browser bundle.
 */
export { ACCOUNT_LIMITS } from "@/lib/account-limits";

export class VerificationError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * Brand rather than relying on `instanceof` alone: a class extending a
   * built-in can lose its prototype chain when a build target downlevels
   * classes, which would silently send these errors down the 500 path.
   */
  readonly isVerificationError = true as const;

  constructor(message: string, status = 400, code = "VERIFICATION_ERROR") {
    super(message);
    this.name = "VerificationError";
    this.status = status;
    this.code = code;
  }
}

/** Safe check that works regardless of the transpilation target. */
export function isVerificationError(error: unknown): error is VerificationError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { isVerificationError?: unknown }).isVerificationError === true
  );
}

/** Cryptographically strong, URL-safe token (64 hex chars). */
function mintToken(): string {
  return randomBytes(32).toString("hex");
}

export type IssuedToken = {
  token: string;
  expiresAt: Date;
};

/**
 * Mint a fresh confirmation token for an account.
 *
 * Each call rotates the token, which invalidates any previously issued link —
 * the expected behaviour when a user hits "resend".
 */
export async function issueVerificationToken(userId: string): Promise<IssuedToken> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, isEmailVerified: true },
  });

  if (!user) {
    throw new VerificationError(
      "Your session is no longer valid. Please sign in again.",
      401,
      "UNAUTHENTICATED",
    );
  }

  // Nothing to do if already confirmed; keeps the UI from offering a dead link.
  if (user.isEmailVerified) {
    throw new VerificationError(
      "This email is already verified.",
      409,
      "ALREADY_VERIFIED",
    );
  }

  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);
  const token = mintToken();

  try {
    await prisma.user.update({
      where: { id: userId },
      data: { verificationToken: token, verificationTokenExpiresAt: expiresAt },
    });
  } catch (error) {
    // The token is unique across all accounts, so a 256-bit collision with a
    // different user is the only realistic cause. Mint again rather than
    // surfacing a raw Prisma error as a 500.
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return retryIssue(userId, expiresAt);
    }
    throw error;
  }

  return { token, expiresAt };
}

async function retryIssue(userId: string, expiresAt: Date): Promise<IssuedToken> {
  const token = mintToken();
  await prisma.user.update({
    where: { id: userId },
    data: { verificationToken: token, verificationTokenExpiresAt: expiresAt },
  });
  return { token, expiresAt };
}

/**
 * Redeem a confirmation token.
 *
 * Expired and unknown tokens are reported distinctly so the UI can tell the
 * user which one happened, but neither leaks whether an address exists.
 */
export async function confirmVerificationToken(token: string): Promise<{
  userId: string;
  email: string;
}> {
  const trimmed = token.trim();

  if (trimmed === "" || trimmed.length > 200) {
    throw new VerificationError("This confirmation link is not valid.", 400, "INVALID_TOKEN");
  }

  const user = await prisma.user.findUnique({
    where: { verificationToken: trimmed },
    select: {
      id: true,
      email: true,
      isEmailVerified: true,
      verificationTokenExpiresAt: true,
    },
  });

  if (!user) {
    throw new VerificationError(
      "This confirmation link is not valid or has already been used.",
      404,
      "TOKEN_NOT_FOUND",
    );
  }

  // Already confirmed: treat as success so a double-open does not look broken.
  if (user.isEmailVerified) {
    await clearToken(user.id);
    return { userId: user.id, email: user.email };
  }

  const expiresAt = user.verificationTokenExpiresAt;
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    // Deliberately left in place: clearing it here would turn every subsequent
    // open of the same stale link into a generic "invalid" instead of the
    // "expired" message the user needs. The next request rotates it anyway.
    throw new VerificationError(
      "This confirmation link has expired. Request a new one.",
      410,
      "TOKEN_EXPIRED",
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      isEmailVerified: true,
      verificationToken: null,
      verificationTokenExpiresAt: null,
    },
  });

  return { userId: user.id, email: user.email };
}

async function clearToken(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { verificationToken: null, verificationTokenExpiresAt: null },
  });
}