-- Legacy grant backfill.
--
-- Before deposits existed, new users were created with a $100,000 cash default
-- that was never recorded as a transaction. Now that profit/loss is measured
-- against total deposits, that unrecorded grant would read as a $100,000
-- phantom gain on the dashboard.
--
-- Record it as a single DEPOSIT for every user who does not already have one,
-- so their balance is explained in history and their P&L baseline is correct.
-- New users (created after this migration) get $0 and no grant.

INSERT INTO "Transaction" (
    "id", "userId", "symbol", "type", "shares", "price",
    "amount", "currency", "provider", "reference", "createdAt"
)
SELECT
    lower(hex(randomblob(16))),
    "User"."id",
    NULL,
    'DEPOSIT',
    0,
    0,
    100000,
    'USD',
    'legacy-grant',
    'legacy-grant-' || "User"."id",
    CURRENT_TIMESTAMP
FROM "User"
WHERE NOT EXISTS (
    SELECT 1 FROM "Transaction"
    WHERE "Transaction"."userId" = "User"."id"
      AND "Transaction"."type" = 'DEPOSIT'
);
