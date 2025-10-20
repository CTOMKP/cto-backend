/*
  Warnings:

  - A unique constraint covering the columns `[circleUserId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "circleAppId" TEXT,
ADD COLUMN     "circlePinStatus" TEXT,
ADD COLUMN     "circleUserId" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "circleWalletId" TEXT NOT NULL,
    "address" TEXT,
    "blockchain" "Chain" NOT NULL,
    "type" TEXT,
    "description" TEXT,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_circleWalletId_key" ON "Wallet"("circleWalletId");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_blockchain_idx" ON "Wallet"("blockchain");

-- CreateIndex
CREATE UNIQUE INDEX "User_circleUserId_key" ON "User"("circleUserId");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
