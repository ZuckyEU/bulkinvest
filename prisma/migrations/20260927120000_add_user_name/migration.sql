-- AlterTable: add the display username used by the credentials sign-up form.
-- SQLite cannot add a NOT NULL column to a populated table without a default,
-- so we add it with a temporary default and then repopulate it.
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';

-- Repopulate any pre-existing rows with a placeholder derived from the email.
UPDATE "User" SET "name" = substr("email", 1, instr("email", '@') - 1) WHERE "name" = '';

-- Remove the pre-auth placeholder account created by the old demo-account
-- helper. It was provisioned automatically with the unusable password
-- "no-auth-configured", so it can never sign in through the credentials
-- provider. Its holdings/transactions cascade away with it.
DELETE FROM "User" WHERE "email" = 'demo@bulkinvest.local';
