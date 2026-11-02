import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";
import { ProfileMenu } from "@/components/ProfileMenu";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const NAV_LINKS = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Markets", href: "/markets" },
  { label: "History", href: "/history" },
];

type AppShellProps = {
  /** Label of the nav item to highlight. */
  active: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
};

/** First letters of the first two words, e.g. "jane trader" -> "JT". */
function initialsFor(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.slice(0, 2).map((word) => word[0]);
  return letters.join("").toUpperCase();
}

/**
 * Shared chrome for signed-in app pages: ambient background, sticky header
 * (with the current user) and the page heading block.
 */
export async function AppShell({
  active,
  title,
  description,
  actions,
  children,
}: AppShellProps) {
  const user = await getSessionUser();
  const label = user?.name?.trim() || user?.email || "Account";

  // The JWT session carries only id/name/email, so the menu's verification dot
  // needs the one row it is reading for — a single indexed lookup.
  const account = user?.id
    ? await prisma.user.findUnique({
        where: { id: user.id },
        select: { email: true, isEmailVerified: true },
      })
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#05070d] text-slate-300">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="absolute -top-40 left-1/4 h-[32rem] w-[32rem] rounded-full bg-emerald-500/10 blur-[130px]" />
        <div className="absolute top-20 right-[-12rem] h-[28rem] w-[28rem] rounded-full bg-sky-500/10 blur-[130px]" />
      </div>

      <header className="sticky top-0 z-50 border-b border-white/5 bg-[#05070d]/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const isActive = link.label === active;
              return (
                <a
                  key={link.label}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-full px-4 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-white/10 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[10rem] truncate text-sm text-slate-400 sm:block">
              {label}
            </span>
            <ProfileMenu
              label={label}
              initials={initialsFor(label)}
              email={account?.email ?? user?.email ?? ""}
              verified={account?.isEmailVerified ?? false}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 text-sm text-slate-400">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex gap-3">{actions}</div> : null}
        </div>

        <div className="mt-8">{children}</div>
      </main>
    </div>
  );
}
