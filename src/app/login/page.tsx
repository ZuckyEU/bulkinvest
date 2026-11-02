import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { LoginForm } from "@/components/LoginForm";
import { getSessionUser } from "@/lib/session";

export const metadata = {
  title: "Sign in — BulkInvest",
  description: "Sign in to your BulkInvest paper-trading account.",
};

// Reads the session and the ?callbackUrl query, so it must not be prerendered.
export const dynamic = "force-dynamic";

/**
 * Only allow same-site absolute paths, so `?callbackUrl=` cannot be used as an
 * open redirect to an attacker's site.
 */
function safeCallbackUrl(value: string | undefined): string {
  if (!value) return "/dashboard";
  if (!value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

type LoginPageProps = {
  searchParams: { callbackUrl?: string };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to your paper-trading account."
      footer={
        <>
          New to BulkInvest?{" "}
          <Link href="/signup" className="text-emerald-400 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm callbackUrl={safeCallbackUrl(searchParams.callbackUrl)} />
    </AuthShell>
  );
}
