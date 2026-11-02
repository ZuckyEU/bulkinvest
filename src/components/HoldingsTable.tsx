import Link from "next/link";
import { DeltaBadge } from "@/components/DeltaBadge";
import {
  formatPercent,
  formatSignedUSD,
  formatUSD,
} from "@/lib/format";
import { formatQuantity, toAssetSlug } from "@/lib/symbols";
import type { LiveHolding } from "@/lib/live";

type HoldingsTableProps = {
  holdings: LiveHolding[];
  holdingsValue: number;
  className?: string;
};

/**
 * Open positions with live valuation and daily move.
 *
 * Presentational only: the values are recomputed by the caller (server render
 * or the browser's 30-second refresh), so this component never fetches.
 */
export function HoldingsTable({
  holdings,
  holdingsValue,
  className = "",
}: HoldingsTableProps) {
  const totalCostBasis = holdings.reduce(
    (total, holding) => total + holding.costBasis,
    0,
  );
  const totalUnrealized = holdingsValue - totalCostBasis;
  const totalDaily = holdings.reduce(
    (total, holding) => total + (holding.dailyChange ?? 0),
    0,
  );

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-white/[0.03] ${className}`}
    >
      <div className="flex items-center justify-between px-6 py-5">
        <h2 className="text-lg font-semibold text-white">Holdings</h2>
        <span className="text-xs text-slate-500">
          {holdings.length === 0
            ? "No positions"
            : `${formatUSD(holdingsValue)} total`}
        </span>
      </div>

      {holdings.length === 0 ? (
        <div className="border-t border-white/5 px-6 py-16 text-center">
          <p className="text-sm font-medium text-slate-400">No open positions</p>
          <p className="mt-1 text-xs text-slate-600">
            Buy your first stock from the{" "}
            <Link href="/markets" className="text-emerald-400 hover:underline">
              Markets
            </Link>{" "}
            page and it will appear here.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <thead>
              <tr className="border-t border-white/5 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-6 py-3 text-left font-medium">Asset</th>
                <th className="px-3 py-3 text-right font-medium">
                  Shares / Units Held
                </th>
                <th className="px-3 py-3 text-right font-medium">
                  Avg Entry Price
                </th>
                <th className="px-3 py-3 text-right font-medium">
                  Current Price
                </th>
                <th className="px-3 py-3 text-right font-medium">Today</th>
                <th className="px-3 py-3 text-right font-medium">
                  Value on Stake
                </th>
                <th className="px-6 py-3 text-right font-medium">
                  Unrealized Gain/Loss
                </th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => {
                const positive = holding.unrealizedPnl >= 0;
                // Fall back to the ticker so the cell is never blank.
                const assetName = holding.name?.trim() || holding.symbol;

                return (
                  <tr
                    key={holding.symbol}
                    className="group border-t border-white/5 transition-colors hover:bg-white/[0.04]"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {/*
                          The whole row is the hit area via a stretched link
                          overlay, which keeps the markup valid (a <tr> cannot
                          wrap an <a>) while leaving one link per row for
                          keyboard and screen-reader users.
                        */}
                        <Link
                          href={`/markets/${toAssetSlug(holding.symbol)}`}
                          className="relative grid h-9 w-16 shrink-0 place-items-center rounded-lg bg-white/5 font-mono text-xs font-semibold text-slate-200 transition-colors group-hover:bg-emerald-400/10 group-hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60 after:absolute after:inset-0 after:content-[''] focus-visible:after:inset-0"
                        >
                          {holding.symbol}
                          <span className="sr-only">— view {assetName} and close position</span>
                        </Link>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-300">
                            {assetName}
                          </p>
                          <div className="mt-1.5 flex items-center gap-2">
                            <span
                              className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-white/5"
                              title={`${formatPercent(holding.weight)} of holdings`}
                            >
                              <span
                                className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-500"
                                style={{ width: `${holding.weight}%` }}
                              />
                            </span>
                            <span className="text-[11px] text-slate-500">
                              {formatPercent(holding.weight)} of book
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-4 text-right font-mono text-slate-300">
                      {formatQuantity(holding.shares)}
                    </td>

                    <td className="px-3 py-4 text-right text-slate-300">
                      {formatUSD(holding.avgPrice)}
                    </td>

                    <td className="px-3 py-4 text-right text-slate-300">
                      {formatUSD(holding.currentPrice)}
                      {!holding.hasLiveQuote ? (
                        <span className="ml-2 rounded bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                          no quote
                        </span>
                      ) : null}
                    </td>

                    <td className="px-3 py-4 text-right">
                      <DeltaBadge
                        change={holding.dailyChange}
                        changePercent={holding.dailyChangePercent}
                      />
                    </td>

                    <td className="px-3 py-4 text-right font-medium text-white">
                      {formatUSD(holding.marketValue)}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div
                        className={`font-medium ${
                          positive ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {formatSignedUSD(holding.unrealizedPnl)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {formatPercent(holding.unrealizedPnlPercent, true)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td className="px-6 py-4 text-xs uppercase tracking-wider text-slate-500">
                  Total
                </td>
                <td className="px-3 py-4" />
                <td className="px-3 py-4" />
                <td className="px-3 py-4" />
                <td className="px-3 py-4 text-right">
                  <DeltaBadge change={totalDaily} changePercent={null} />
                </td>
                <td className="px-3 py-4 text-right font-semibold text-white">
                  {formatUSD(holdingsValue)}
                </td>
                <td
                  className={`px-6 py-4 text-right font-semibold ${
                    totalUnrealized >= 0 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {formatSignedUSD(totalUnrealized)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
}
