import { AppShell } from "@/components/AppShell";
import { StockExplorer } from "@/components/StockExplorer";
import { getFeaturedQuotes } from "@/lib/featured-assets";

export const metadata = {
  title: "Markets — BulkInvest",
  description:
    "Search stocks by ticker or company name and explore interactive price history charts.",
};

/**
 * /markets
 *
 * The resting state is a curated Trending & Popular grid rather than an empty
 * prompt, so the page is useful before anyone searches. Featured prices are
 * fetched on the server so the cards paint with real numbers on first load; the
 * grid then keeps them fresh in the browser.
 *
 * A pricing failure must not take the page down, so it degrades to an empty
 * grid that the client retries.
 */
export default async function MarketsPage() {
  const featured = await getFeaturedQuotes().catch(() => []);

  return (
    <AppShell
      active="Markets"
      title="Markets"
      description="Search any ticker to explore its price history"
    >
      <StockExplorer initialFeatured={featured} />
    </AppShell>
  );
}