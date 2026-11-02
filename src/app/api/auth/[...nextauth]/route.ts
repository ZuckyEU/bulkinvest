import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Auth.js route handler.
 *
 * Serves every /api/auth/* endpoint (session, csrf, signin, signout, ...).
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
