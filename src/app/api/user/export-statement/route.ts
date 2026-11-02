import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import {
  buildStatement,
  statementFilename,
  toCsv,
} from "@/lib/statement";

/**
 * GET /api/user/export-statement
 *
 * Downloads the signed-in user's full history as CSV with the columns
 * Date, Type, Asset, Amount, Price, Status — covering deposits, withdrawals and
 * stock/crypto trades.
 *
 * Session-scoped: rows are read only for `user.id`, so no session can reach
 * another account's history. Always 200s with at least the header row rather
 * than erroring on an empty account, because "download my statement" on a new
 * account is a legitimate request.
 *
 * No UTF-8 BOM is emitted: every value written here is ASCII (ISO timestamps,
 * tickers, currency codes, uppercased statuses), so a BOM would buy nothing
 * while making naive parsers read a stray prefix as part of the first header
 * cell.
 *
 * 200 text/csv | 401 | 500
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json(
      { error: "You must be signed in.", code: "UNAUTHENTICATED" },
      { status: 401 },
    );
  }

  try {
    const rows = await buildStatement(user.id);

    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${statementFilename()}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Unexpected error in GET /api/user/export-statement:", error);
    return NextResponse.json(
      { error: "Could not build your statement.", code: "EXPORT_FAILED" },
      { status: 500 },
    );
  }
}