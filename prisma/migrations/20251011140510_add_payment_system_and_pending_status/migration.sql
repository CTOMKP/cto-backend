-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('LISTING', 'AD_BOOST', 'ESCROW', 'WITHDRAWAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "paymentType" "PaymentType" NOT NULL,
    "listingId" TEXT,
    "adBoostId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDC',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "transferId" TEXT,
    "txHash" TEXT,
    "fromWalletId" TEXT,
    "toAddress" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payment_transferId_key" ON "Payment"("transferId");

-- CreateIndex
CREATE INDEX "Payment_userId_idx" ON "Payment"("userId");

-- CreateIndex
CREATE INDEX "Payment_paymentType_idx" ON "Payment"("paymentType");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_transferId_idx" ON "Payment"("transferId");

-- CreateIndex
CREATE INDEX "Payment_listingId_idx" ON "Payment"("listingId");

-- CreateIndex
CREATE INDEX "Payment_adBoostId_idx" ON "Payment"("adBoostId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
