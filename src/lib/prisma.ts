import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Normalise the Postgres connection string for the environment it runs in.
 *
 * Supabase (and serverless Postgres generally) needs three things that are easy
 * to get wrong across local and Vercel environments:
 *
 * - TLS is mandatory on Supabase. If `sslmode` is absent Prisma can fail the
 *   handshake with "SSL/TLS required" or a certificate-chain mismatch, so it is
 *   defaulted to `require`. An explicit value in the URL always wins; use
 *   `sslmode=no-verify` if a proxy presents a chain Prisma does not trust.
 * - Every Vercel invocation is a separate process, so the default Prisma pool
 *   (up to ~3 connections per instance) exhausts Supabase's connection limit
 *   under load. Pooled/Supabase connections are capped at one per instance.
 * - Supabase's transaction-mode pooler (port 6543) does not support prepared
 *   statements. Prisma needs `pgbouncer=true` or queries fail with protocol
 *   errors after the first one.
 *
 * Anything that is not a remote Postgres URL (a local database without TLS, a
 * `file:` URL, ...) is returned untouched.
 */
export function resolveDatabaseUrl(
  raw: string | undefined = process.env.DATABASE_URL,
): string | undefined {
  if (!raw) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a URL Prisma can parse either; let Prisma report the real error.
    return raw;
  }

  if (!/^postgres(ql)?:$/i.test(url.protocol)) return raw;
  if (LOCAL_HOSTNAMES.has(url.hostname)) return raw;

  const params = url.searchParams;

  if (!params.has("sslmode")) {
    params.set("sslmode", "require");
  }

  const isSupabasePooler = url.hostname.endsWith(".pooler.supabase.com");
  const isTransactionPooler = isSupabasePooler && url.port === "6543";

  if (isTransactionPooler && !params.has("pgbouncer")) {
    params.set("pgbouncer", "true");
  }

  // One connection per serverless instance keeps Supabase's pool healthy.
  if ((isSupabasePooler || process.env.VERCEL) && !params.has("connection_limit")) {
    params.set("connection_limit", "1");
  }

  return url.toString();
}

const databaseUrl = resolveDatabaseUrl();

const createPrismaClient = () => {
  return new PrismaClient({
    ...(databaseUrl ? { datasourceUrl: databaseUrl } : {}),
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
};

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export default prisma;
