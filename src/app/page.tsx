"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { Logo } from "@/components/Logo";

type Feature = {
  title: string;
  description: string;
  icon: ReactNode;
};

const features: Feature[] = [
  {
    title: "Real-time market data",
    description:
      "Stream live quotes for stocks, ETFs, and crypto so every practice trade feels like the real thing.",
    icon: (
      <path
        d="M3 17l5-6 4 3 6-8M21 6h-5v5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Instant paper trades",
    description:
      "Buy and sell in milliseconds with realistic order types and zero settlement delays.",
    icon: (
      <path
        d="M4 7h16M4 12h10M4 17h7M17 14l3 3-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Portfolio analytics",
    description:
      "Track P&L, allocation, volatility, and drawdown with clean charts that update in real time.",
    icon: (
      <path
        d="M4 19V5m0 14h16M8 15v-4m4 4V8m4 7v-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Global leaderboards",
    description:
      "Compete against thousands of traders in weekly seasons and climb the rankings.",
    icon: (
      <path
        d="M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0V4zM5 5H3v2a3 3 0 003 3M19 5h2v2a3 3 0 01-3 3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Smart watchlists",
    description:
      "Follow the tickers you care about and get alerts when they hit your price targets.",
    icon: (
      <path
        d="M12 4l2.4 1.8 3-.1.1 3L19.3 11l-1.8 2.4.1 3-3 .1L12 18.3 9.6 16.5l-3 .1-.1-3L4.7 11l1.8-2.4-.1-3 3-.1L12 4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    title: "Learn as you go",
    description:
      "Guided lessons and trade breakdowns explain the why behind every position you take.",
    icon: (
      <path
        d="M4 5.5A2.5 2.5 0 016.5 3H20v15H6.5A2.5 2.5 0 004 20.5v-15zM4 20.5A2.5 2.5 0 016.5 18H20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

const stats = [
  { value: "120K+", label: "Active traders" },
  { value: "$4.2B", label: "Simulated volume" },
  { value: "1.2M", label: "Orders matched" },
  { value: "$0", label: "Real money at risk" },
];

const steps = [
  {
    step: "01",
    title: "Create your account",
    description:
      "Sign up in under a minute and fund your portfolio with virtual cash whenever you like.",
  },
  {
    step: "02",
    title: "Place your first trade",
    description:
      "Search any ticker, size your position, and execute against live market prices.",
  },
  {
    step: "03",
    title: "Track, learn, repeat",
    description:
      "Review performance, spot patterns, and sharpen your strategy before going live.",
  },
];

/** Navbar tab switcher. `target` scrolls to the matching section where one exists. */
const navTabs: { label: string; target?: string }[] = [
  { label: "Features", target: "features" },
  { label: "How it works", target: "how" },
  { label: "Pricing", target: "pricing" },
];

/** Floating glass badges arranged around the hero headline. */
const floatingBadges = [
  { label: "Bitora", glyph: "❖", position: "-top-4 left-0", delay: "0s" },
  { label: "Chainly", glyph: "⚛", position: "-top-4 right-0", delay: "1.5s" },
  { label: "Coinza", glyph: "⦿", position: "-bottom-4 left-4", delay: "0.8s" },
  { label: "Nexbit", glyph: "🎯", position: "-bottom-4 right-4", delay: "2.2s" },
];

/** Dark markets list for the left hero card. */
const showcaseAssets: {
  ticker: string;
  name: string;
  change: string;
  points: number[];
}[] = [
  { ticker: "BTA", name: "Bitora", change: "+6.24%", points: [16, 12, 14, 10, 12, 8, 9, 6, 7, 4] },
  { ticker: "CHY", name: "Chainly", change: "-2.18%", points: [8, 10, 9, 12, 11, 14, 13, 16, 15, 18] },
  { ticker: "NXB", name: "Nexbit", change: "+9.51%", points: [18, 15, 16, 12, 13, 9, 10, 6, 7, 3] },
];

const ranges = ["1D", "1W", "1M", "1Y", "ALL"];

/** Map a series of values into viewBox coordinates. */
function toCoords(
  values: number[],
  width: number,
  height: number,
  pad: number,
): [number, number][] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1 || 1);
  return values.map(
    (value, index) =>
      [index * step, height - pad - ((value - min) / span) * (height - pad * 2)] as [
        number,
        number,
      ],
  );
}

/** Smooth (cubic) path through a set of points. */
function smoothLine(points: [number, number][]): string {
  if (points.length === 0) return "";
  let path = `M ${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    path += ` C ${cx.toFixed(1)} ${y0.toFixed(1)}, ${cx.toFixed(1)} ${y1.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`;
  }
  return path;
}

/** Mini smooth white trend line for the markets list. */
function Sparkline({ values }: { values: number[] }) {
  const width = 64;
  const height = 22;
  const path = smoothLine(toCoords(values, width, height, 3));
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-5 w-16 shrink-0"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={path}
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** White glowing balance line with an orange glow fading up from the base. */
function BalanceChart() {
  const values = [22, 30, 26, 38, 33, 46, 41, 55, 50, 66, 60, 78, 72, 90, 86, 100];
  const width = 320;
  const height = 120;
  const line = smoothLine(toCoords(values, width, height, 8));
  const area = `${line} L${width} ${height} L0 ${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="mt-6 h-32 w-full"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="balance-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.5" />
        </linearGradient>
      </defs>

      {[30, 60, 90].map((y) => (
        <line
          key={y}
          x1="0"
          x2={width}
          y1={y}
          y2={y}
          stroke="rgba(255,255,255,0.05)"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
      ))}

      <path d={area} fill="url(#balance-area)" />
      <path
        d={line}
        stroke="#ffffff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        style={{ filter: "drop-shadow(0 0 6px rgba(255,255,255,0.75))" }}
      />
    </svg>
  );
}

/** One side of the crypto exchange swap interface. */
function SwapField({
  label,
  secondary,
  amount,
  asset,
  dotClass,
}: {
  label: string;
  secondary: string;
  amount: string;
  asset: string;
  dotClass: string;
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3.5">
      <div className="flex items-center justify-between text-[11px] text-zinc-500">
        <span>{label}</span>
        <span>{secondary}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-lg font-semibold text-white">{amount}</span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-100">
          <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
          {asset}
          <svg viewBox="0 0 24 24" className="h-3 w-3 text-zinc-500" fill="none" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}

const metallicCard =
  "bg-gradient-to-b from-[#1C1C21] via-[#121215] to-[#0A0A0C] border border-white/10 rounded-2xl shadow-2xl";

export default function Home() {
  const [activeTab, setActiveTab] = useState("Features");

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0B0B0E] text-slate-300">
      {/* Ambient background — obsidian base with a glowing orange/coral nebula */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-600/20 via-black to-black" />
        <div className="absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(ellipse_at_top,black,transparent_70%)]" />
        <div className="absolute -top-32 left-1/2 h-[36rem] w-[36rem] -translate-x-1/2 rounded-full bg-orange-500/20 blur-[140px]" />
        <div className="absolute top-64 right-[-8rem] h-[28rem] w-[28rem] rounded-full bg-red-600/15 blur-[130px]" />
        <div className="absolute bottom-0 left-[-8rem] h-[26rem] w-[26rem] rounded-full bg-amber-500/10 blur-[130px]" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50">
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6">
          <nav className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-2xl border border-white/10 bg-[#0B0B0E]/70 px-4 py-2.5 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center">
              <Logo />
            </div>

            <div className="hidden items-center gap-1 justify-self-center rounded-full border border-white/10 bg-[#1A1A20]/80 p-1 shadow-xl backdrop-blur-md lg:flex">
              {navTabs.map((tab) => {
                const active = activeTab === tab.label;
                return (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => {
                      setActiveTab(tab.label);
                      if (tab.target) {
                        document
                          .getElementById(tab.target)
                          ?.scrollIntoView({ behavior: "smooth" });
                      }
                    }}
                    className={
                      active
                        ? "bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-full shadow-lg shadow-orange-500/20 transition-all duration-300 px-4 py-1.5 text-sm font-medium"
                        : "rounded-full px-4 py-1.5 text-sm font-medium text-zinc-400 transition-all duration-300 hover:text-white"
                    }
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-3">
              <a
                href="/login"
                className="hidden text-sm text-zinc-300 transition-colors hover:text-white sm:block"
              >
                Sign in
              </a>
              <a
                href="/signup"
                className="rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-orange-500/20 transition hover:opacity-90"
              >
                Get started
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section id="top" className="relative overflow-hidden">
          {/* Pure CSS glowing horizon background */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {/* Central glowing orange gradient sun/horizon */}
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-gradient-to-t from-orange-600/30 via-orange-500/20 to-transparent rounded-full blur-[120px]" />
            {/* Top atmospheric vignette */}
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-orange-950/40 via-[#0B0B0E]/80 to-[#0B0B0E]" />
          </div>

          <div className="relative z-10 mx-auto max-w-6xl px-6 pt-20 pb-24 text-center sm:pt-28">
          <div className="relative mx-auto max-w-4xl">
            {floatingBadges.map((badge) => (
              <span
                key={badge.label}
                style={{ animationDelay: badge.delay }}
                className={`absolute z-10 hidden animate-floaty items-center gap-1.5 rounded-full border border-white/10 bg-[#1A1A20]/80 px-4 py-1.5 text-xs text-zinc-300 shadow-xl backdrop-blur-md motion-reduce:animate-none xl:inline-flex ${badge.position}`}
              >
                {badge.label}
                <span className="text-orange-400">{badge.glyph}</span>
              </span>
            ))}

            <h1 className="text-balance text-5xl font-semibold leading-[1.05] tracking-tight text-white sm:text-7xl">
              Invest smarter with <span className="text-gradient">BulkInvest</span>
            </h1>
          </div>

          <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-slate-400">
            Practice trading real markets using virtual cash. Build a portfolio,
            test your strategy, and learn from every decision — without risking
            a single cent.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <a
              href="/signup"
              className="w-full rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:opacity-90 sm:w-auto"
            >
              Start investing free
            </a>
            <a
              href="#how"
              className="w-full rounded-full border border-white/10 bg-white/5 px-7 py-3.5 text-sm font-semibold text-white backdrop-blur transition-colors hover:bg-white/10 sm:w-auto"
            >
              See how it works
            </a>
          </div>

          <p className="mt-5 text-xs text-slate-500">
            No credit card required · Fund your account with virtual cash
          </p>

          {/* Dashboard preview — floating metallic cards */}
          <div className="relative mx-auto mt-16 max-w-6xl">
            <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-72 w-[42rem] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full bg-orange-500/20 blur-[120px]" />

            <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-3">
              {/* Left — Markets list */}
              <div className="lg:-rotate-1 lg:translate-y-6 lg:hover:translate-y-3">
                <div className={`${metallicCard} p-6 text-left transition-transform duration-300 hover:-translate-y-1.5`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Markets</h3>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                      Live
                    </span>
                  </div>

                  <div className="mt-5 space-y-2.5">
                    {showcaseAssets.map((asset) => (
                      <div
                        key={asset.ticker}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3.5 py-2.5 transition-colors hover:bg-white/[0.06]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/5 font-mono text-[11px] font-semibold text-zinc-200">
                            {asset.ticker.slice(0, 1)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-mono text-sm text-zinc-200">
                              {asset.ticker}
                            </p>
                            <p className="truncate text-[11px] text-zinc-500">
                              {asset.name}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Sparkline values={asset.points} />
                          <span className="rounded-full bg-orange-500/15 px-2.5 py-1 text-xs font-semibold text-orange-400">
                            {asset.change}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Center — Main balance */}
              <div className="relative z-10 lg:scale-[1.04]">
                <div className={`${metallicCard} p-6 text-left transition-transform duration-300 hover:-translate-y-1.5`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-widest text-zinc-500">
                        Portfolio value
                      </p>
                      <p className="mt-1 text-3xl font-semibold text-white">
                        $15,475<span className="ml-1.5 text-lg font-medium text-zinc-400">USD</span>
                      </p>
                    </div>
                    <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                      +28.4%
                    </span>
                  </div>

                  <BalanceChart />

                  <div className="mt-5 flex items-center gap-1.5">
                    {ranges.map((range) => (
                      <span
                        key={range}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                          range === "1M"
                            ? "bg-orange-500/20 text-orange-300"
                            : "text-zinc-500"
                        }`}
                      >
                        {range}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Right — Crypto exchange */}
              <div className="lg:rotate-1 lg:translate-y-6 lg:hover:translate-y-3">
                <div className={`${metallicCard} p-6 text-left transition-transform duration-300 hover:-translate-y-1.5`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">
                      Crypto exchange
                    </h3>
                    <span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-orange-400">
                      Swap
                    </span>
                  </div>

                  <div className="mt-5">
                    <SwapField
                      label="You pay"
                      secondary="≈ 0.418 ETH"
                      amount="1,000.00"
                      asset="USD"
                      dotClass="bg-orange-400"
                    />

                    <div className="relative z-10 -my-2 flex justify-center">
                      <button
                        type="button"
                        aria-label="Swap assets"
                        className="grid h-8 w-8 place-items-center rounded-full border border-white/10 bg-[#1C1C21] text-orange-400 shadow-lg transition-transform duration-300 hover:rotate-180"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden="true">
                          <path
                            d="M7 4v13m0 0l-3-3m3 3l3-3M17 20V7m0 0l-3 3m3-3l3 3"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>

                    <SwapField
                      label="You receive"
                      secondary="≈ 26.4 NXB"
                      amount="12.48"
                      asset="BTA"
                      dotClass="bg-white"
                    />
                  </div>

                  <a
                    href="/signup"
                    className="mt-5 block w-full rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-lg shadow-orange-500/20 transition hover:opacity-90"
                  >
                    Exchange
                  </a>
                </div>
              </div>
            </div>
          </div>
          </div>
        </section>

        {/* Stats */}
        <section className="border-y border-white/5 bg-zinc-900/40">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <p className="text-3xl font-semibold text-white">
                  {stat.value}
                </p>
                <p className="mt-1 text-sm text-slate-500">{stat.label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section id="features" className="mx-auto max-w-6xl px-6 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-orange-400">
              Features
            </p>
            <h2 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Everything you need to trade with confidence
            </h2>
            <p className="mt-4 text-lg text-slate-400">
              A complete investing sandbox, built to feel as fast and detailed as
              the tools professionals use.
            </p>
          </div>

          <div className="mt-16 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-white/5 bg-zinc-900/50 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/30 hover:bg-zinc-900/80 hover:shadow-2xl hover:shadow-orange-500/5"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-orange-500/20 to-red-600/20 text-orange-400 transition-colors group-hover:text-orange-300">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-5 w-5"
                    aria-hidden="true"
                  >
                    {feature.icon}
                  </svg>
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="border-t border-white/5 bg-zinc-900/40">
          <div className="mx-auto max-w-6xl px-6 py-24">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold uppercase tracking-widest text-orange-400">
                How it works
              </p>
              <h2 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                From zero to your first trade
              </h2>
            </div>

            <div className="mt-16 grid grid-cols-1 gap-6 md:grid-cols-3">
              {steps.map((item) => (
                <div
                  key={item.step}
                  className="relative rounded-2xl border border-white/5 bg-zinc-900/50 p-7 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500/30 hover:bg-zinc-900/80 hover:shadow-2xl hover:shadow-orange-500/5"
                >
                  <span className="font-mono text-sm font-semibold text-orange-400">
                    {item.step}
                  </span>
                  <h3 className="mt-4 text-xl font-semibold text-white">
                    {item.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-slate-400">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-900/50 px-8 py-16 text-center backdrop-blur-xl">
            <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-orange-500/25 blur-[110px]" />
            <h2 className="relative text-balance text-4xl font-semibold tracking-tight text-white sm:text-5xl">
              Ready to invest without the risk?
            </h2>
            <p className="relative mx-auto mt-4 max-w-xl text-lg text-slate-400">
              Join thousands of traders sharpening their skills on BulkInvest.
              Free forever — upgrade only if you want pro analytics.
            </p>
            <div className="relative mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="/signup"
                className="w-full rounded-full bg-gradient-to-r from-orange-500 to-red-600 px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-orange-500/25 transition hover:opacity-90 sm:w-auto"
              >
                Create free account
              </a>
              <a
                href="#"
                className="w-full rounded-full border border-white/10 bg-white/5 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10 sm:w-auto"
              >
                Talk to us
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-6 py-10 sm:flex-row">
          <Logo />
          <p className="text-sm text-slate-500">
            © {new Date().getFullYear()} BulkInvest. Simulated trading only.
          </p>
          <div className="flex gap-6 text-sm text-slate-500">
            <a className="transition-colors hover:text-white" href="#">
              Privacy
            </a>
            <a className="transition-colors hover:text-white" href="#">
              Terms
            </a>
            <a className="transition-colors hover:text-white" href="#">
              Contact
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
