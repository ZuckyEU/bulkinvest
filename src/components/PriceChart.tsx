"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatCompactUSD, formatUSD } from "@/lib/format";
import type { PricePoint } from "@/lib/market-types";

type PriceChartProps = {
  points: PricePoint[];
  interval: string;
  positive: boolean;
};

const POSITIVE_COLOR = "#34d399";
const NEGATIVE_COLOR = "#fb7185";

/** Intraday intervals need a time label; longer ranges need a date label. */
function makeTickFormatter(interval: string) {
  const isIntraday = interval.endsWith("m");
  const isLongRange = interval === "1wk" || interval === "1mo";

  return (iso: string): string => {
    const date = new Date(iso);

    if (isIntraday) {
      return date.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
    }

    if (isLongRange) {
      return date.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
    }

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };
}

export function PriceChart({ points, interval, positive }: PriceChartProps) {
  const gradientId = useId().replace(/:/g, "");
  const color = positive ? POSITIVE_COLOR : NEGATIVE_COLOR;
  const formatTick = makeTickFormatter(interval);

  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="rgba(148,163,184,0.08)"
            vertical={false}
          />

          <XAxis
            dataKey="date"
            tickFormatter={formatTick}
            tick={{ fill: "#64748b", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            minTickGap={48}
          />

          <YAxis
            domain={["auto", "auto"]}
            tickFormatter={(value: number) => formatCompactUSD(value)}
            tick={{ fill: "#64748b", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={64}
            orientation="right"
          />

          <Tooltip
            cursor={{ stroke: "rgba(148,163,184,0.3)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const point = payload[0]?.payload as PricePoint | undefined;
              if (!point) return null;

              return (
                <div className="rounded-lg border border-white/10 bg-[#0a0e18] px-3 py-2 text-xs shadow-xl shadow-black/50">
                  <p className="text-slate-400">
                    {new Date(point.date).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="mt-1 font-semibold text-white">
                    {formatUSD(point.close)}
                  </p>
                  <div className="mt-1 flex gap-3 text-slate-500">
                    {point.open !== null ? <span>O {formatUSD(point.open)}</span> : null}
                    {point.high !== null ? <span>H {formatUSD(point.high)}</span> : null}
                    {point.low !== null ? <span>L {formatUSD(point.low)}</span> : null}
                  </div>
                </div>
              );
            }}
          />

          <Area
            type="monotone"
            dataKey="close"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: color }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
