import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

/**
 * Centered card used by the sign-in and sign-up pages, matching the landing
 * page's ambient background.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#05070d] px-6 py-16 text-slate-300">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-grid opacity-50 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="absolute -top-40 left-1/2 h-[32rem] w-[32rem] -translate-x-1/2 rounded-full bg-emerald-500/15 blur-[130px]" />
        <div className="absolute bottom-[-8rem] right-[-8rem] h-[26rem] w-[26rem] rounded-full bg-sky-500/15 blur-[130px]" />
      </div>

      <div className="w-full max-w-md">
        <div className="flex justify-center">
          <Link href="/" aria-label="BulkInvest home">
            <Logo />
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-white/[0.03] p-8 backdrop-blur">
          <h1 className="text-2xl font-semibold tracking-tight text-white">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm text-slate-400">{subtitle}</p>
          ) : null}

          <div className="mt-6">{children}</div>
        </div>

        {footer ? (
          <div className="mt-6 text-center text-sm text-slate-500">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
