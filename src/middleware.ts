import { withAuth } from "next-auth/middleware";

/**
 * Route protection.
 *
 * The portfolio pages require a session. Unauthenticated visitors are
 * redirected to /login with a `callbackUrl` pointing back to the page they
 * tried to open. (This is the first line of defence — the pages and API routes
 * also verify the session themselves.)
 *
 * Runs on the edge runtime, so it only inspects the signed JWT cookie; it never
 * touches the database.
 */
export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/markets/:path*",
    "/history/:path*",
    "/settings/:path*",
  ],
};
