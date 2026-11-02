import { notFound } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { AssetDetail } from "@/components/AssetDetail";
import { fromAssetSlug } from "@/lib/symbols";

/**
 * /markets/[ticker]
 *
 * A deep link to a single asset, used when a holding row is clicked. It is the
 * same explorer the Markets page shows, pre-selected to this ticker and — when
 * the signed-in user holds it — focused on closing the position.
 *
 * The ticker arrives URL-safe: `BTC/USD` is linked as `BTC-USD` (see
 * `toAssetSlug`) because a raw slash would split into extra path segments.
 */
export const dynamic = "force-dynamic";

type AssetPageProps = {
  params: { ticker: string };
};

export function generateMetadata({ params }: AssetPageProps) {
  const symbol = fromAssetSlug(params.ticker);
  return {
    title: `${symbol} — BulkInvest`,
    description: `Price history and trading for ${symbol}.`,
  };
}

export default function AssetPage({ params }: AssetPageProps) {
  const symbol = fromAssetSlug(params.ticker);
  // Equity tickers may contain a dot or dash; crypto pairs carry a slash.
  if (!/^(?:[A-Z0-9.\-]{1,15}|[A-Z0-9]{2,10}\/[A-Z0-9]{2,10})$/.test(symbol)) notFound();

  return (
    <AppShell
      active="Markets"
      title={symbol}
      description="Review the position, then buy more or close it out"
    >
      <AssetDetail symbol={symbol} />
    </AppShell>
  );
}