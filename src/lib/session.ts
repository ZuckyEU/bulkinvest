import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Session access for server components and route handlers.
 *
 * Thin wrapper so callers do not repeat the authOptions import, and so there is
 * a single place to change if the auth library is swapped out.
 */
export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}
