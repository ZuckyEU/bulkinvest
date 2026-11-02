import { NextResponse } from "next/server";
import {
  parseRegisterBody,
  registerUser,
  SignupError,
} from "@/lib/users";

/**
 * POST /api/signup
 *
 * Body: { username: string, email: string, password: string }
 *
 * Creates a paper-trading account with a bcrypt-hashed password. Does not
 * create a session — the client signs in straight after via the credentials
 * provider so there is a single authentication code path.
 *
 * 201 { user: { id, name, email } }
 * 400 validation error | 409 email already registered | 500 unexpected
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  try {
    const input = parseRegisterBody(raw);
    const user = await registerUser(input);

    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    if (error instanceof SignupError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("Unexpected error in POST /api/signup:", error);
    return NextResponse.json(
      { error: "Could not create the account.", code: "INTERNAL_ERROR" },
      { status: 500 },
    );
  }
}
