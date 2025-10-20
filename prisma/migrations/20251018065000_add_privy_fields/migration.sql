-- AlterTable: Add Privy fields to User table
ALTER TABLE "User" ADD COLUMN "privyUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "privyDid" TEXT;

-- CreateIndex: Add unique constraints
CREATE UNIQUE INDEX "User_privyUserId_key" ON "User"("privyUserId");
CREATE UNIQUE INDEX "User_privyDid_key" ON "User"("privyDid");

-- AlterTable: Update Wallet table for Privy support
ALTER TABLE "Wallet" ALTER COLUMN "circleWalletId" DROP NOT NULL;
ALTER TABLE "Wallet" ADD COLUMN "privyWalletId" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "walletClient" TEXT;
ALTER TABLE "Wallet" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex: Add index on wallet address
CREATE INDEX "Wallet_address_idx" ON "Wallet"("address");

