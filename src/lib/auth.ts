import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { DUMMY_PASSWORD_HASH, verifyPassword } from "@/lib/password";

/**
 * Auth.js (NextAuth.js) configuration.
 *
 * Sessions are JWT-based: the signed cookie carries the user id, so protected
 * server components and route handlers can resolve the current account without
 * a database round-trip just to read the session. Every data query still scopes
 * by that id, so a user can only ever read or mutate their own rows.
 *
 * The secret comes from NEXTAUTH_SECRET (see .env).
 */
export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Email and password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });

        // Always run a bcrypt comparison, even for an unknown email, so the
        // response time does not reveal whether the account exists.
        const valid = await verifyPassword(
          password,
          user?.password ?? DUMMY_PASSWORD_HASH,
        );

        if (!user || !valid) return null;

        return { id: user.id, name: user.name, email: user.email };
      },
    }),
  ],
  callbacks: {
    // Persist the database id onto the token so it survives in the session.
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    // Expose that id to the client/server session as `session.user.id`.
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
};
