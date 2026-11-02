import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcryptjs is a pure-JavaScript implementation of bcrypt, so there is no
 * native build step (`bcrypt` needs a compiler toolchain on Windows).
 *
 * Cost 12 is a reasonable default: noticeably slower than the library default
 * of 10 while staying well under a second on modern hardware.
 */

const BCRYPT_COST = 12;

/** bcrypt only considers the first 72 bytes of a password. */
export const MAX_PASSWORD_BYTES = 72;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_COST);
}

/**
 * Constant-time-ish comparison that never throws.
 *
 * A malformed or truncated stored hash returns false instead of blowing up the
 * sign-in request.
 */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A syntactically valid bcrypt hash of a random value.
 *
 * Used to burn the same CPU time when an email is not found, so the response
 * latency does not leak whether an account exists.
 */
export const DUMMY_PASSWORD_HASH =
  "$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW";
