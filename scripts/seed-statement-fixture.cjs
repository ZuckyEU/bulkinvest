/*
 * Seeds a throwaway user (identified by email + a unique stamp) with ledger
 * rows that exercise every branch of the statement builder, in particular the
 * crypto double-count guard.
 *
 * Usage:  node scripts/seed-statement-fixture.cjs <email> <stamp>
 */
const fs = require("fs");
const path = require("path");

// Prisma Client does not load .env on its own (only the CLI does), so parse it.
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !m[1] || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  const stamp = process.argv[3];
  if (!email || !stamp) throw new Error("usage: seed-statement-fixture.cjs <email> <stamp>");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`no user for ${email}`);

  // 1. A settled deposit: Transaction credited AND a CryptoDeposit pointing at
  //    it. Must appear ONCE (matched by reference *and* transactionId).
  const settled = await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "DEPOSIT",
      shares: 0,
      price: 0,
      amount: 100,
      currency: "USD",
      provider: "nowpayments",
      reference: `nowpayments:PAY-A-${stamp}`,
    },
  });
  await prisma.cryptoDeposit.create({
    data: {
      userId: user.id,
      providerId: `PAY-A-${stamp}`,
      orderId: `ord-A-${stamp}`,
      asset: "USDT",
      payCurrency: "usdttrc20",
      amountUsd: 100,
      status: "finished",
      transactionId: settled.id,
    },
  });

  // 2. A pending deposit with no credit yet. Must appear ONCE, from CryptoDeposit.
  await prisma.cryptoDeposit.create({
    data: {
      userId: user.id,
      providerId: `PAY-B-${stamp}`,
      orderId: `ord-B-${stamp}`,
      asset: "BTC",
      payCurrency: "btc",
      amountUsd: 250,
      status: "waiting",
    },
  });

  // 3. The replay hazard: the Transaction exists (reference set) but the
  //    CryptoDeposit's transactionId is still null. Dedup must key on the
  //    reference, else this $500 deposit is counted twice.
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "DEPOSIT",
      shares: 0,
      price: 0,
      amount: 500,
      currency: "USD",
      provider: "nowpayments",
      reference: `nowpayments:PAY-C-${stamp}`,
    },
  });
  await prisma.cryptoDeposit.create({
    data: {
      userId: user.id,
      providerId: `PAY-C-${stamp}`,
      orderId: `ord-C-${stamp}`,
      asset: "ETH",
      payCurrency: "eth",
      amountUsd: 500,
      status: "finished",
    },
  });

  // 4. A withdrawal request.
  await prisma.withdrawalRequest.create({
    data: {
      userId: user.id,
      asset: "USDT",
      network: "TRON (TRC20)",
      amountUsd: 40,
      address: "TFixtureAddress000000000000000000",
      reference: `WD-${stamp}`,
      status: "PENDING",
    },
  });

  // 5. A filled trade: broker status resolved via Order.providerId.
  await prisma.order.create({
    data: {
      userId: user.id,
      providerId: `ORD-FILL-${stamp}`,
      symbol: "AAPL",
      side: "buy",
      type: "market",
      qty: 2,
      status: "filled",
      filledQty: 2,
      filledAvgPrice: 150,
    },
  });
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "BUY",
      symbol: "AAPL",
      shares: 2,
      price: 150,
      reference: `ORD-FILL-${stamp}`,
    },
  });

  // 6. A queued trade with no fill and no quote: amount/price must be blank,
  //    never $0.00, and status falls back to RECORDED.
  await prisma.transaction.create({
    data: {
      userId: user.id,
      type: "BUY",
      symbol: "TSLA",
      shares: 0,
      price: 0,
    },
  });

  console.log(`seeded statement fixture for ${email} (stamp ${stamp})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
