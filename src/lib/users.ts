import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { hashPassword, MAX_PASSWORD_BYTES } from "@/lib/password";

/**
 * Account creation used by the /signup form.
 *
 * Kept separate from the Auth.js configuration so the validation rules are
 * unit-testable and the route handler stays thin.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 50;

// Deliberately permissive: enough to reject obvious typos without trying to
// out-clever the email grammar.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
};

export type PublicUser = {
  id: string;
  name: string;
  email: string;
};

export class SignupError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "INVALID_SIGNUP") {
    super(message);
    this.name = "SignupError";
    this.status = status;
    this.code = code;
  }
}

function normalizeName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim().replace(/\s+/g, " ") : "";
  if (name.length < MIN_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
    throw new SignupError(
      `Username must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters.`,
      400,
      "INVALID_NAME",
    );
  }
  return name;
}

function normalizeEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw new SignupError(
      "Enter a valid email address.",
      400,
      "INVALID_EMAIL",
    );
  }
  return email;
}

function validatePassword(raw: unknown): string {
  const password = typeof raw === "string" ? raw : "";
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new SignupError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      400,
      "INVALID_PASSWORD",
    );
  }
  // Reject rather than silently truncate: bcrypt only hashes the first 72 bytes.
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    throw new SignupError(
      `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`,
      400,
      "INVALID_PASSWORD",
    );
  }
  return password;
}

export function parseRegisterBody(raw: unknown): RegisterInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new SignupError("Request body must be a JSON object.", 400, "INVALID_BODY");
  }

  const body = raw as Record<string, unknown>;

  return {
    name: normalizeName(body.name ?? body.username),
    email: normalizeEmail(body.email),
    password: validatePassword(body.password),
  };
}

export async function registerUser(input: RegisterInput): Promise<PublicUser> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });

  if (existing) {
    throw new SignupError(
      "An account with that email already exists.",
      409,
      "EMAIL_TAKEN",
    );
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        password: passwordHash,
      },
      select: { id: true, name: true, email: true },
    });

    return user;
  } catch (error) {
    // A concurrent signup can win the unique-email race between the check above
    // and the insert; surface it as the same 409 instead of a 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new SignupError(
        "An account with that email already exists.",
        409,
        "EMAIL_TAKEN",
      );
    }
    throw error;
  }
}
