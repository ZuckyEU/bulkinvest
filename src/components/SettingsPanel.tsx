"use client";

import { useEffect, useState } from "react";
import {
  ACCOUNT_LIMITS,
  formatDailyLimit,
  tierFor,
} from "@/lib/account-limits";
import { formatDate } from "@/lib/format";

/**
 * The /settings screen: Account & Verification, and Account Statements.
 *
 * Client component because both halves are interactive — issuing a confirmation
 * link and showing what came back from it. Everything it displays is passed in
 * from the server-rendered page, so the first paint needs no fetch.
 */

export type VerifyResult = "1" | "invalid" | "expired" | "error";

type SettingsPanelProps = {
  name: string;
  email: string;
  verified: boolean;
  memberSince: string;
  /** Outcome carried back on the query string by the confirmation link. */
  verifyResult?: VerifyResult;
};

type TabId = "account" | "statements";

type Toast = {
  kind: "success" | "error" | "info";
  title: string;
  body?: string;
  /** Present when the toast carries an actionable link; those never auto-dismiss. */
  url?: string;
};

const TABS: { id: TabId; label: string }[] = [
  { id: "account", label: "Account & Verification" },
  { id: "statements", label: "Account Statements" },
];

const TOAST_MS = 8_000;

const VERIFY_MESSAGES: Record<Exclude<VerifyResult, "1">, Toast> = {
  invalid: {
    kind: "error",
    title: "That confirmation link is not valid",
    body: "It may have already been used. Request a new one below.",
  },
  expired: {
    kind: "error",
    title: "Confirmation link expired",
    body: "Links are valid for 15 minutes. Request a new one below.",
  },
  error: {
    kind: "error",
    title: "Could not confirm your email",
    body: "Something went wrong completing that link. Try issuing a new one.",
  },
};

export function SettingsPanel({
  name,
  email,
  verified,
  memberSince,
  verifyResult,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<TabId>("account");
  const [toast, setToast] = useState<Toast | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Report the result of a followed confirmation link exactly once, then strip
  // it from the URL so a refresh does not replay the message.
  useEffect(() => {
    if (!verifyResult) return;

    setToast(
      verifyResult === "1"
        ? {
            kind: "success",
            title: "Email verified",
            body: "Your account is now on the verified tier.",
          }
        : VERIFY_MESSAGES[verifyResult],
    );

    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/settings");
    }
  }, [verifyResult]);

  // Auto-dismiss, but never a toast holding a link the user still needs.
  useEffect(() => {
    if (!toast || toast.url) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // Escape clears the toast.
  useEffect(() => {
    if (!toast) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setToast(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toast]);

  async function issueLink() {
    setIssuing(true);
    setCopied(false);

    try {
      const response = await fetch("/api/user/verify-email", { method: "POST" });
      const body = await response.json().catch(() => null);

      if (!response.ok || !body?.url) {
        setToast({
          kind: "error",
          title: body?.error ?? "Could not create a confirmation link",
        });
        return;
      }

      setToast({
        kind: "info",
        title: "Confirmation link created",
        // Honest about delivery: no transport is configured, so we hand over
        // the link instead of claiming an email was sent.
        body: "No email provider is configured in this environment, so nothing was sent to your inbox. Open the link below to confirm your address.",
        url: body.url as string,
      });
    } catch {
      setToast({
        kind: "error",
        title: "Could not create a confirmation link",
        body: "Check your connection and try again.",
      });
    } finally {
      setIssuing(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard access can be denied; the link stays visible either way.
      setCopied(false);
    }
  }

  return (
    <>
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex flex-wrap gap-2 border-b border-white/5 pb-3"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`panel-${entry.id}`}
            onClick={() => setTab(entry.id)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 ${
              tab === entry.id
                ? "bg-white/10 text-white"
                : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/*
        Both panels stay mounted so every tab's `aria-controls` resolves to a
        real element and the hidden one drops out of the tab order.
      */}
      <div
        role="tabpanel"
        id="panel-account"
        aria-labelledby="tab-account"
        hidden={tab !== "account"}
        tabIndex={0}
        className="mt-8"
      >
        <AccountTab
          name={name}
          email={email}
          verified={verified}
          memberSince={memberSince}
          issuing={issuing}
          onIssue={issueLink}
        />
      </div>

      <div
        role="tabpanel"
        id="panel-statements"
        aria-labelledby="tab-statements"
        hidden={tab !== "statements"}
        tabIndex={0}
        className="mt-8"
      >
        <StatementsTab verified={verified} />
      </div>

      {/*
        The live region is always mounted and empty; a screen reader only
        announces a `status` region that existed before its content arrived.
        The card inside is position:fixed, so this wrapper occupies no space.
      */}
      <div role="status" aria-live="polite">
        {toast ? (
          <ToastCard
            toast={toast}
            onClose={() => setToast(null)}
            onCopy={copyLink}
            copied={copied}
          />
        ) : null}
      </div>
    </>
  );
}

/* ---------------------------- account & verification ---------------------------- */

function AccountTab({
  name,
  email,
  verified,
  memberSince,
  issuing,
  onIssue,
}: {
  name: string;
  email: string;
  verified: boolean;
  memberSince: string;
  issuing: boolean;
  onIssue: () => void;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Account details</h2>
        <dl className="mt-5 divide-y divide-white/5">
          <Detail label="Account name" value={name} />
          <Detail label="Email" value={email} />
          <Detail label="Member since" value={formatDate(memberSince)} />
        </dl>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Email verification</h2>
            <span
              className={`mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium ${
                verified
                  ? "bg-emerald-400/10 text-emerald-400"
                  : "bg-amber-400/10 text-amber-400"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${
                  verified ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              {verified ? "Email Verified" : "Email Unverified"}
            </span>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-slate-400">
          {verified
            ? "Your address is confirmed, so your account is on the higher daily limit."
            : "Confirm your email address to raise your daily account limit. No documents or ID upload required."}
        </p>

        {verified ? null : (
          <button
            type="button"
            onClick={onIssue}
            disabled={issuing}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]"
          >
            {issuing ? (
              <>
                <span
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950/30 border-t-slate-950"
                />
                Preparing…
              </>
            ) : (
              "Send Verification Email"
            )}
          </button>
        )}
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-slate-500">{label}</dt>
      <dd className="truncate text-sm font-medium text-slate-200">{value}</dd>
    </div>
  );
}

/* ------------------------------- statements ------------------------------- */

function StatementsTab({ verified }: { verified: boolean }) {
  const tier = tierFor(verified);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Account limits</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Daily limits by verification tier.
        </p>

        <div className="mt-5 grid gap-3">
          {(["unverified", "verified"] as const).map((key) => {
            const isCurrent = tier === key;
            return (
              <div
                key={key}
                className={`flex items-center justify-between rounded-xl border px-4 py-3.5 transition-colors ${
                  isCurrent
                    ? "border-emerald-400/40 bg-emerald-400/5"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div>
                  <p
                    className={`text-sm font-medium ${
                      isCurrent ? "text-emerald-300" : "text-slate-300"
                    }`}
                  >
                    {key === "verified" ? "Verified" : "Unverified"}
                    <span className="ml-2 text-xs font-normal text-slate-600">
                      {key === "verified"
                        ? "Email confirmed"
                        : "Email not confirmed"}
                    </span>
                  </p>
                </div>
                <div className="text-right">
                  <p
                    className={`text-lg font-semibold ${
                      isCurrent ? "text-emerald-300" : "text-white"
                    }`}
                  >
                    {formatDailyLimit(ACCOUNT_LIMITS[key])}
                  </p>
                  <p className="text-[11px] uppercase tracking-wide text-slate-600">
                    per day
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-4 text-xs leading-relaxed text-slate-600">
          {verified
            ? "Your email is confirmed, so the higher tier applies."
            : `Confirm your email address to move to the ${formatDailyLimit(
                ACCOUNT_LIMITS.verified,
              )} daily limit.`}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-lg font-semibold text-white">Export history</h2>
        <p className="mt-1.5 text-sm text-slate-500">
          Download every deposit, withdrawal and trade as a spreadsheet.
        </p>

        <ul className="mt-5 space-y-2 text-sm text-slate-400">
          <li className="flex items-center gap-2.5">
            <Check /> Deposits (card and crypto)
          </li>
          <li className="flex items-center gap-2.5">
            <Check /> Withdrawal requests
          </li>
          <li className="flex items-center gap-2.5">
            <Check /> Stock and crypto trades
          </li>
        </ul>

        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-slate-600">
            Columns
          </p>
          <p className="mt-1 font-mono text-xs text-slate-400">
            Date, Type, Asset, Amount, Price, Status
          </p>
        </div>

        <a
          href="/api/user/export-statement"
          download
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#05070d]"
        >
          <DownloadIcon />
          Export History (CSV)
        </a>
      </section>
    </div>
  );
}

function Check() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="h-4 w-4 shrink-0 text-emerald-400"
    >
      <path
        d="M4 10.5 8 14.5 16 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="h-4 w-4"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
      />
    </svg>
  );
}

/* --------------------------------- toast --------------------------------- */

function ToastCard({
  toast,
  onClose,
  onCopy,
  copied,
}: {
  toast: Toast;
  onClose: () => void;
  onCopy: (url: string) => void;
  copied: boolean;
}) {
  const styles =
    toast.kind === "success"
      ? "border-emerald-400/30 bg-emerald-400/10"
      : toast.kind === "error"
        ? "border-rose-400/30 bg-rose-400/10"
        : "border-sky-400/30 bg-sky-400/10";

  const text =
    toast.kind === "success"
      ? "text-emerald-300"
      : toast.kind === "error"
        ? "text-rose-300"
        : "text-sky-300";

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 w-[min(26rem,calc(100vw-3rem))] rounded-2xl border p-4 shadow-2xl shadow-black/60 backdrop-blur-xl ${styles}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold ${text}`}>{toast.title}</p>
          {toast.body ? (
            <p className="mt-1 text-xs leading-relaxed text-slate-300">{toast.body}</p>
          ) : null}

          {toast.url ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <a
                href={toast.url}
                className="max-w-full truncate rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                Open confirmation link
              </a>
              <button
                type="button"
                onClick={() => onCopy(toast.url!)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-300 transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Dismiss notification"
          className="-mr-1 -mt-1 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="h-4 w-4"
          >
            <path
              d="m5 5 10 10M15 5 5 15"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}