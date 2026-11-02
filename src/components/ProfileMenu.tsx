"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

/**
 * Header profile menu: avatar button that reveals Settings and Sign out.
 *
 * The nav links collapse below `md`, so putting Settings behind the avatar keeps
 * it reachable on every screen size without adding a fourth link.
 *
 * Keyboard contract: Escape and Tab both close the menu and return focus to
 * the toggle, opening moves focus to the first item, ArrowUp/ArrowDown move
 * between items, and clicking outside closes. The popup is only rendered while
 * open, so hidden items never sit in the tab order.
 */

type ProfileMenuProps = {
  /** Display name, e.g. "Jane Trader". */
  label: string;
  /** Avatar initials, e.g. "JT". */
  initials: string;
  email: string;
  verified: boolean;
};

export function ProfileMenu({ label, initials, email, verified }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click/tap outside the menu dismisses it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Escape/Tab close and return focus to the toggle; ArrowDown/ArrowUp move
  // between items while open. Handlers are inlined rather than calling an outer
  // function so this effect does not resubscribe on every render.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (event.key === "Tab") {
        // React unmounts the focused item as Tab advances, which would strand
        // focus on <body>. Close first and land on the toggle instead, exactly
        // as Escape does, so the next Tab continues normally.
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const items = menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']");
        if (!items || items.length === 0) return;

        event.preventDefault();
        const list = Array.from(items);
        const index = list.indexOf(document.activeElement as HTMLElement);
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const next = index < 0 ? 0 : (index + delta + list.length) % list.length;
        list[next]?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Move focus into the menu when it opens, so Tab lands on a real item.
  useEffect(() => {
    if (open) {
      menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    }
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${label}`}
        onClick={() => setOpen((previous) => !previous)}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-sky-500 text-sm font-semibold text-slate-950 transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
      >
        {initials}
      </button>

      {open ? (
        /*
          The positioned popup is deliberately not the `role="menu"` itself:
          the profile header above is not a menu item, and putting it inside
          would make the menu's content invalid. Only the actions are grouped
          under the menu role.
        */
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1120] shadow-2xl shadow-black/50">
          <div className="border-b border-white/5 px-3 py-3">
            <p className="truncate text-sm font-medium text-white">{label}</p>
            <p className="mt-0.5 truncate text-xs text-slate-500">{email}</p>
            <span
              className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                verified
                  ? "bg-emerald-400/10 text-emerald-400"
                  : "bg-amber-400/10 text-amber-400"
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${
                  verified ? "bg-emerald-400" : "bg-amber-400"
                }`}
              />
              {verified ? "Email verified" : "Email unverified"}
            </span>
          </div>

          <div
            ref={menuRef}
            role="menu"
            aria-label="Account"
            className="flex flex-col gap-0.5 p-1.5"
          >
            <Link
              role="menuitem"
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <SettingsIcon />
              Settings
            </Link>

            <button
              role="menuitem"
              type="button"
              onClick={() => void signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
            >
              <SignOutIcon />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4 text-slate-500"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M10.3 4.3a2 2 0 0 1 3.4 0l.3.5a2 2 0 0 0 2.6.9l.5-.2a2 2 0 0 1 2.7 2.7l-.2.5a2 2 0 0 0 .9 2.6l.5.3a2 2 0 0 1 0 3.4l-.5.3a2 2 0 0 0-.9 2.6l.2.5a2 2 0 0 1-2.7 2.7l-.5-.2a2 2 0 0 0-2.6.9l-.3.5a2 2 0 0 1-3.4 0l-.3-.5a2 2 0 0 0-2.6-.9l-.5.2a2 2 0 0 1-2.7-2.7l.2-.5a2 2 0 0 0-.9-2.6l-.5-.3a2 2 0 0 1 0-3.4l.5-.3a2 2 0 0 0 .9-2.6l-.2-.5a2 2 0 0 1 2.7-2.7l.5.2a2 2 0 0 0 2.6-.9z"
      />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className="h-4 w-4 text-slate-500"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9"
      />
    </svg>
  );
}