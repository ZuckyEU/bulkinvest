"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_LIMITS = void 0;
exports.tierFor = tierFor;
exports.formatDailyLimit = formatDailyLimit;
exports.ACCOUNT_LIMITS = {
    /** Daily limit before the email address is confirmed. */
    unverified: 1000,
    /** Daily limit once confirmed. */
    verified: 50000,
};
function tierFor(isVerified) {
    return isVerified ? "verified" : "unverified";
}
/** Formats a limit as e.g. "$1,000" / "$50,000". */
function formatDailyLimit(limit) {
    return `$${limit.toLocaleString("en-US")}`;
}
