/**
 * Isomorphic account types (safe for client components).
 */

export type AccountHolding = {
  symbol: string;
  /**
   * Display name, e.g. "Apple Inc."
   *
   * Optional: the local paper ledger stores no names, so only the Alpaca-backed
   * shapes populate it. Callers should fall back to the symbol.
   */
  name?: string | null;
  shares: number;
  avgPrice: number;
};

export type AccountSummary = {
  id: string;
  name: string;
  email: string;
  /** Available cash (Alpaca when configured, otherwise the local ledger). */
  cashBalance: number;
  holdings: AccountHolding[];
};
