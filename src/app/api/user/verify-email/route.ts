import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  confirmVerificationToken,
  isVerificationError,
  issueVerificationToken,
} from "@/lib/verification";

/**
 * /api/user/verify-email
 *
 * POST -> mint a confirmation token for the signed-in account.
 * GET  -> redeem `?token=`, then redirect back to /settings with the outcome.
 *
 * The GET handler exists so the generated link behaves like a real emailed
 * confirmation link: it can be opened in a new tab, needs no session (a bounce
 * through an email client may land in a different cookie jar), and returns to
 * the settings page to show the result.
 *
 * 201 { token, url, expiresAt, delivered:false } | 400 | 401 | 409 | 303 redirect
 */
export const dynamic = "force-dynamic";

/**
 * The app has no mail transport (no SMTP/SES/Resend configured anywhere), so
 * nothing is actually delivered. We say so explicitly rather than returning a
 * success message the user can never observe.
 */
const NO_MAIL_PROVIDER = "NO_MAIL_PROVIDER";

function appBaseUrl(request: Request): string {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  try {
    const { token, expiresAt } = await issueVerificationToken(user.id);
    const base = appBaseUrl(request);

    return NextResponse.json(
      {
        token,
        // The link the user would receive if a mail provider were configured.
        url: `${base}/api/user/verify-email?token=${encodeURIComponent(token)}`,
        expiresAt: expiresAt.toISOString(),
        delivered: false,
        reason: NO_MAIL_PROVIDER,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (isVerificationError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status },
      );
    }

    console.error("Unexpected error in POST /api/user/verify-email:", error);
    return NextResponse.json(
      { error: "Could not create a verification link.", code: "VERIFICATION_FAILED" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const base = appBaseUrl(request);
  // 303 so a browser always follows it with GET, whatever method hit us.
  const redirectTo = (query: string) =>
    NextResponse.redirect(new URL(`/settings?${query}`, base), 303);

  try {
    await confirmVerificationToken(token);
    return redirectTo("verified=1");
  } catch (error) {
    if (isVerificationError(error)) {
      // Expired gets its own message; anything else reads as invalid.
      return redirectTo(error.code === "TOKEN_EXPIRED" ? "verified=expired" : "verified=invalid");
    }

    console.error("Unexpected error in GET /api/user/verify-email:", error);
    return redirectTo("verified=error");
  }
}