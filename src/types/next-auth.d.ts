import type { DefaultSession } from "next-auth";

/**
 * Make `session.user.id` a first-class, required field.
 *
 * The `jwt`/`session` callbacks in src/lib/auth.ts always populate it from the
 * token subject, so downstream code can rely on it being present (instead of
 * casting through `any`). `sub` is the user's database id.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}
