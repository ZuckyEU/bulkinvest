/**
 * Isomorphic portfolio types.
 *
 * Kept free of the Alpaca SDK import so client components can consume the
 * shapes without pulling the trading library into the browser bundle.
 */

export type AlpacaAccount = {
  cash: number | null;
  buyingPower: number | null;
  equity: number | null;
  lastEquity: number | null;
  portfolioValue: number | null;
  currency: string | null;
  status: string | null;
  cryptoStatus: string | null;
  tradingBlocked: boolean;
  accountBlocked: boolean;
};

export type AlpacaPosition = {
  symbol: string;
  /** Display name, e.g. "Apple Inc."; null when the provider cannot name it. */
  name: string | null;
  qty: number;
  side: string | null;
  assetClass: string | null;
  avgEntryPrice: number | null;
  currentPrice: number | null;
  lastdayPrice: number | null;
  costBasis: number | null;
  marketValue: number | null;
  unrealizedPl: number | null;
  unrealizedPlPercent: number | null;
  /** qty x (currentPrice - lastdayPrice). */
  dailyChange: number | null;
  dailyChangePercent: number | null;
};

export type PortfolioSnapshot = {
  source: "alpaca";
  /** False when ALPACA_PAPER="false" (a live account). */
  paper: boolean;
  asOf: string;
  account: AlpacaAccount;
  positions: AlpacaPosition[];
  totals: {
    positionsValue: number;
    costBasis: number;
    unrealizedPl: number;
    dailyChange: number;
  };
  /** Accepted-but-unfilled orders, so queued trades stay visible. */
  pendingOrders: PendingOrder[];
};

/** A locally-tracked order that has not filled yet. */
export type PendingOrder = {
  id: string;
  symbol: string;
  side: string;
  type: string;
  qty: number;
  notional: number | null;
  limitPrice: number | null;
  status: string;
  referencePrice: number | null;
  assetClass: string | null;
  submittedAt: string;
};
