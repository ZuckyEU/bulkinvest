import type { AccountSummary } from "@/lib/account-types";

/**
 * Portfolio valuation maths.
 *
 * Pure functions (no fetching, no Prisma) so the numbers can be unit tested
 * and reused on the server or the client.
 *
 * Profit/loss is measured against **total deposited cash**, not a fixed
 * starting balance: users begin at $0 and fund the account themselves, so
 * deposits are the only honest baseline. (Counting deposits as profit would
 * make the P&L figure meaningless.)
 */

export type PricedHolding = {
  symbol: string;
  /** Display name, e.g. "Apple Inc."; falls back to the symbol when unknown. */
  name?: string | null;
  shares: number;
  avgPrice: number;
  /** Live price, or the average cost when no quote is available. */
  currentPrice: number;
  /** False when the position could not be priced and avgPrice was used. */
  hasLiveQuote: boolean;
  costBasis: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  /** Share of the holdings value, as a percentage. */
  weight: number;
};

export type PortfolioSummary = {
  cashBalance: number;
  /** Total cash the user has deposited, in USD. */
  deposits: number;
  holdingsValue: number;
  costBasis: number;
  /** Cash plus holdings. */
  totalValue: number;
  /** totalValue - deposits: what the account has actually gained or lost. */
  pnl: number;
  pnlPercent: number;
  unrealizedPnl: number;
  /**
   * Net P/L not explained by open positions, i.e. settled profit from sells.
   * Approximate: the schema stores no cost basis on transactions.
   */
  realizedPnl: number;
  holdings: PricedHolding[];
};

/** symbol -> latest price */
export type PriceMap = Record<string, number | undefined>;

export function buildPortfolio(
  account: AccountSummary,
  prices: PriceMap,
  deposits: number,
): PortfolioSummary {
  const priced: PricedHolding[] = account.holdings.map((holding) => {
    const quote = prices[holding.symbol];
    const hasLiveQuote = typeof quote === "number" && Number.isFinite(quote) && quote > 0;
    // Falling back to cost keeps totals coherent instead of dropping the
    // position: an unpriced row simply shows zero unrealized P/L.
    const currentPrice = hasLiveQuote ? (quote as number) : holding.avgPrice;

    const costBasis = holding.shares * holding.avgPrice;
    const marketValue = holding.shares * currentPrice;
    const unrealizedPnl = marketValue - costBasis;

    return {
      symbol: holding.symbol,
      shares: holding.shares,
      avgPrice: holding.avgPrice,
      currentPrice,
      hasLiveQuote,
      costBasis,
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent: costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100,
      weight: 0,
    };
  });

  const holdingsValue = priced.reduce((total, h) => total + h.marketValue, 0);
  const costBasis = priced.reduce((total, h) => total + h.costBasis, 0);
  const unrealizedPnl = holdingsValue - costBasis;

  const totalValue = account.cashBalance + holdingsValue;
  const pnl = totalValue - deposits;

  return {
    cashBalance: account.cashBalance,
    deposits,
    holdingsValue,
    costBasis,
    totalValue,
    pnl,
    pnlPercent: deposits === 0 ? 0 : (pnl / deposits) * 100,
    unrealizedPnl,
    realizedPnl: pnl - unrealizedPnl,
    holdings: priced.map((holding) => ({
      ...holding,
      weight: holdingsValue === 0 ? 0 : (holding.marketValue / holdingsValue) * 100,
    })),
  };
}
