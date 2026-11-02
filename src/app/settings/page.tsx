import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SettingsPanel, type VerifyResult } from "@/components/SettingsPanel";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/session";

export const metadata = {
  title: "Settings — BulkInvest",
  description: "Manage your account details, email verification and statements.",
};

type SettingsPageProps = {
  /** `?verified=1|invalid|expired|error` after following a confirmation link. */
  searchParams?: { verified?: string };
};

/**
 * /settings
 *
 * Loads only what the settings screen displays — the account row for the
 * verification badge — so the page has no dependency on portfolio or market
 * data and renders even while the broker is unreachable.
 *
 * Protected by middleware; the session re-check here covers middleware being
 * bypassed and a session outliving a deleted account.
 */
export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await getSessionUser();
  if (!session) {
    redirect("/login?callbackUrl=/settings");
  }

  const account = await prisma.user.findUnique({
    where: { id: session.id },
    select: { name: true, email: true, isEmailVerified: true, createdAt: true },
  });

  if (!account) {
    redirect("/login");
  }

  const verified = searchParams?.verified;

  return (
    <AppShell
      active="Settings"
      title="Settings"
      description="Account details, email verification and statements."
    >
      <SettingsPanel
        name={account.name}
        email={account.email}
        verified={account.isEmailVerified}
        memberSince={account.createdAt.toISOString()}
        verifyResult={verified as VerifyResult | undefined}
      />
    </AppShell>
  );
}