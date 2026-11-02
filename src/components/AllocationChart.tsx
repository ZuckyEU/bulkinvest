"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatPercent, formatUSD } from "@/lib/format";

type AllocationChartProps = {
  /** Broker cash (not the app deposit ledger). */
  cash: number;
  equities: number;
  crypto: number;
};

type Slice = {
  name: string;
  value: number;
  color: string;
};

const COLORS = {
  cash: "#38bdf8",
  equities: "#34d399",
  crypto: "#a78bfa",
} as const;

/**
 * Donut summarising where the trading account's value sits: cash, equities
 * (stocks) and crypto. Values come from the same live snapshot the rest of the
 * dashboard renders, so it updates on the 30-second refresh.
 */
export function AllocationChart({ cash, equities, crypto }: AllocationChartProps) {
  // All three categories are always itemised, so the split is explicit even
  // when a category is empty; the donut itself can only draw non-zero slices.
  const data: Slice[] = [
    { name: "Cash", value: Math.max(cash, 0), color: COLORS.cash },
    { name: "Equities", value: Math.max(equities, 0), color: COLORS.equities },
    { name: "Crypto", value: Math.max(crypto, 0), color: COLORS.crypto },
  ];

  const slices = data.filter((slice) => slice.value > 0);
  const total = data.reduce((sum, slice) => sum + slice.value, 0);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Asset allocation</h2>
        <span className="text-xs text-slate-500">
          {formatUSD(equities + crypto)} invested
        </span>
      </div>

      {total === 0 ? (
        <div className="mt-6 grid h-56 place-items-center rounded-xl border border-dashed border-white/10">
          <p className="text-sm text-slate-500">No value to allocate yet</p>
        </div>
      ) : (
        <>
          <div className="relative mt-4 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="name"
                  innerRadius="62%"
                  outerRadius="88%"
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {slices.map((slice) => (
                    <Cell key={slice.name} fill={slice.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const slice = payload[0]?.payload as Slice | undefined;
                    if (!slice) return null;
                    return (
                      <div className="rounded-lg border border-white/10 bg-[#0a0e18] px-3 py-2 text-xs shadow-xl shadow-black/50">
                        <p className="font-semibold text-white">{slice.name}</p>
                        <p className="mt-1 text-slate-400">
                          {formatUSD(slice.value)} ·{" "}
                          {formatPercent((slice.value / total) * 100)}
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* Centre total */}
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="text-center">
                <p className="text-xs uppercase tracking-widest text-slate-500">
                  Total
                </p>
                <p className="mt-1 text-xl font-semibold text-white">
                  {formatUSD(total)}
                </p>
              </div>
            </div>
          </div>

          <ul className="mt-5 space-y-2.5 border-t border-white/5 pt-4 text-sm">
            {data.map((slice) => (
              <li key={slice.name} className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-slate-400">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: slice.color }}
                    aria-hidden="true"
                  />
                  {slice.name}
                </span>
                <span className="text-right">
                  <span
                    className={
                      slice.value > 0 ? "font-medium text-slate-200" : "text-slate-500"
                    }
                  >
                    {formatUSD(slice.value)}
                  </span>
                  <span className="ml-2 text-xs text-slate-500">
                    {formatPercent(total > 0 ? (slice.value / total) * 100 : 0)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
