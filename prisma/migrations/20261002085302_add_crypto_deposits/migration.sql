-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "txHash" TEXT;

-- CreateTable
CREATE TABLE "CryptoDeposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'nowpayments',
    "providerId" TEXT,
    "orderId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "payCurrency" TEXT NOT NULL,
    "amountUsd" REAL NOT NULL,
    "payAmount" REAL,
    "payAddress" TEXT,
    "network" TEXT,
    "status" TEXT NOT NULL DEFAULT 'waiting',
    "txHash" TEXT,
    "transactionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CryptoDeposit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CryptoDeposit_providerId_key" ON "CryptoDeposit"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoDeposit_orderId_key" ON "CryptoDeposit"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CryptoDeposit_transactionId_key" ON "CryptoDeposit"("transactionId");

-- CreateIndex
CREATE INDEX "CryptoDeposit_userId_idx" ON "CryptoDeposit"("userId");

-- CreateIndex
CREATE INDEX "CryptoDeposit_status_idx" ON "CryptoDeposit"("status");
