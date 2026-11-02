import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/AuthShell";
import { SignupForm } from "@/components/SignupForm";
import { getSessionUser } from "@/lib/session";

export const metadata = {
  title: "Create your account — BulkInvest",
  description:
    "Open a free BulkInvest paper-trading account and start with $100,000 in virtual cash.",
};

// Reads the session to bounce already-signed-in users.
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect("/dashboard");

  return (
    <AuthShell
      title="Create your account"
      subtitle="Open a paper-trading account and add virtual funds when you are ready."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
