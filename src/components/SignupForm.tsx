"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { fieldClass } from "@/components/LoginForm";

export function SignupForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setError(null);

    // Cheap client-side checks for fast feedback; the server re-validates.
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        setError(body?.error ?? "Could not create your account.");
        setSubmitting(false);
        return;
      }

      // Establish the session by signing in with the new credentials.
      const result = await signIn("credentials", {
        redirect: false,
        email,
        password,
        callbackUrl: "/dashboard",
      });

      if (!result || result.error) {
        // The login step failed for some reason; send them to sign in manually.
        router.push("/login");
        return;
      }

      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("Could not create your account. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <label htmlFor="username" className="text-xs font-medium text-slate-400">
          Username
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          minLength={2}
          maxLength={50}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="jane_trader"
          className={`mt-2 ${fieldClass}`}
        />
      </div>

      <div>
        <label htmlFor="email" className="text-xs font-medium text-slate-400">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className={`mt-2 ${fieldClass}`}
        />
      </div>

      <div>
        <label htmlFor="password" className="text-xs font-medium text-slate-400">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          className={`mt-2 ${fieldClass}`}
        />
      </div>

      <div>
        <label htmlFor="confirm" className="text-xs font-medium text-slate-400">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          placeholder="Repeat your password"
          className={`mt-2 ${fieldClass}`}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-3 text-xs text-rose-300"
        >
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-gradient-to-r from-emerald-400 to-sky-500 px-4 py-3 text-sm font-semibold text-slate-950 transition-transform enabled:hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {submitting ? "Creating account..." : "Create account"}
      </button>

      <p className="text-center text-xs text-slate-500">
        Fund your account from the dashboard when you are ready to trade.
      </p>
    </form>
  );
}
