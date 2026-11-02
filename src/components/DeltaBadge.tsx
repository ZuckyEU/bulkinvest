import { formatPercent, formatSignedUSD } from "@/lib/format";

type DeltaBadgeProps = {
  change: number | null;
  changePercent: number | null;
  /** Append the dollar move after the percentage. */
  showAmount?: boolean;
  className?: string;
};

/**
 * Green/red pill for an intraday move.
 *
 * Renders an em dash when the provider gave no change figure (e.g. a halted
 * or newly listed symbol) rather than implying a flat day.
 */
export function DeltaBadge({
  change,
  changePercent,
  showAmount = false,
  className = "",
}: DeltaBadgeProps) {
  if (change === null && changePercent === null) {
    return <span className={`text-xs text-slate-500 ${className}`}>—</span>;
  }

  const basis = changePercent ?? change ?? 0;
  const positive = basis >= 0;
  const arrow = positive ? "M2.5 8.5 5 6l2 1.5 2.5-4" : "M2.5 3.5 5 6l2-1.5 2.5 4";

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${
        positive
          ? "bg-emerald-400/10 text-emerald-400"
          : "bg-rose-400/10 text-rose-400"
      } ${className}`}
    >
      <svg viewBox="0 0 12 12" fill="none" className="h-3 w-3" aria-hidden="true">
        <path
          d={arrow}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {changePercent !== null ? formatPercent(changePercent, true) : ""}
      {showAmount && change !== null
        ? `${changePercent !== null ? " · " : ""}${formatSignedUSD(change)}`
        : ""}
    </span>
  );
}
