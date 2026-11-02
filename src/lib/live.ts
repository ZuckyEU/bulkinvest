import type { AccountSummary } from "@/lib/account-types";
import {
  buildPortfolio,
  type PortfolioSummary,
  type PricedHolding,
} from "@/lib/portfolio";

/**
 * Live-priced portfolio maths.
 *
 * Deposits, holdings and P&L are recomputed from the same pure `buildPortfolio`
 * used on the server, so the browser can refresh prices every 30 seconds and
 * arrive at exactly the numbers a fresh server render would produce.
 *
 * "Daily" figures come from the provider's per-share change since the previous
 * close (Finnhub `d`/`dp`), scaled by the shares held.
 */

/** The quote fields the browser needs to reprice a portfolio. */
export type QuoteInfo = {
  price: number;
  /** Change per share since the previous close, in USD. */
  change: number | null;
  /** Change since the previous close, as a percentage. */
  changePercent: number | null;
};

/** symbol -> latest quote */
export type QuoteMap = Record<string, QuoteInfo | undefined>;

export type LiveHolding = PricedHolding & {
  /** Position gain/loss since the previous close, in USD. */
  dailyChange: number | null;
  /** The same move, as a percentage (from the quote). */
  dailyChangePercent: number | null;
};

export type LivePortfolio = Omit<PortfolioSummary, "holdings"> & {
  holdings: LiveHolding[];
  /** Portfolio gain/loss since the previous close, in USD. */
  dailyChange: number;
  /** The same move against the prior close value, as a percentage. */
  dailyChangePercent: number;
  /** True once at least one holding carried a daily change figure. */
  hasDailyChange: boolean;
};

export function buildLivePortfolio(
  account: AccountSummary,
  quotes: QuoteMap,
  deposits: number,
): LivePortfolio {
  // buildPortfolio only needs prices; the daily fields are layered on after.
  const prices: Record<string, number | undefined> = {};
  for (const [symbol, quote] of Object.entries(quotes)) {
    if (quote) prices[symbol] = quote.price;
  }

  const base = buildPortfolio(account, prices, deposits);

  let dailyChange = 0;
  let hasDailyChange = false;

  const holdings: LiveHolding[] = base.holdings.map((holding) => {
    const quote = quotes[holding.symbol];
    const hasChange =
      quote !== undefined && typeof quote.change === "number" && Number.isFinite(quote.change);

    if (hasChange) {
      dailyChange += holding.shares * (quote.change as number);
      hasDailyChange = true;
    }

    return {
      ...holding,
      dailyChange: hasChange ? holding.shares * (quote.change as number) : null,
      dailyChangePercent: quote?.changePercent ?? null,
    };
  });

  // Cash is unaffected intraday, so the portfolio's prior value is today's
  // value minus today's move. That makes the percentage meaningful.
  const priorValue = base.totalValue - dailyChange;

  return {
    ...base,
    holdings,
    dailyChange,
    dailyChangePercent:
      hasDailyChange && priorValue > 0 ? (dailyChange / priorValue) * 100 : 0,
    hasDailyChange,
  };
}
