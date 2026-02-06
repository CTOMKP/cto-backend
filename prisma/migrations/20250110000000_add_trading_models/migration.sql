-- CreateTable
CREATE TABLE "UserTrade" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "chain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenInAddress" TEXT NOT NULL,
    "tokenOutAddress" TEXT NOT NULL,
    "tokenInSymbol" TEXT,
    "tokenOutSymbol" TEXT,
    "amountIn" TEXT NOT NULL,
    "amountOut" TEXT NOT NULL,
    "price" DECIMAL(65,30),
    "slippageBps" INTEGER NOT NULL,
    "priceImpact" DECIMAL(65,30),
    "txHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "walletId" TEXT,
    "listingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "UserTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingOrder" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "chain" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenInAddress" TEXT NOT NULL,
    "tokenOutAddress" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "quote" JSONB NOT NULL,
    "slippageBps" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "txHash" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PendingOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserTrade_txHash_key" ON "UserTrade"("txHash");

-- CreateIndex
CREATE INDEX "UserTrade_userId_idx" ON "UserTrade"("userId");

-- CreateIndex
CREATE INDEX "UserTrade_txHash_idx" ON "UserTrade"("txHash");

-- CreateIndex
CREATE INDEX "UserTrade_chain_createdAt_idx" ON "UserTrade"("chain", "createdAt");

-- CreateIndex
CREATE INDEX "UserTrade_walletId_idx" ON "UserTrade"("walletId");

-- CreateIndex
CREATE INDEX "UserTrade_listingId_idx" ON "UserTrade"("listingId");

-- CreateIndex
CREATE INDEX "PendingOrder_userId_status_idx" ON "PendingOrder"("userId", "status");

-- CreateIndex
CREATE INDEX "PendingOrder_expiresAt_idx" ON "PendingOrder"("expiresAt");

-- AddForeignKey
ALTER TABLE "UserTrade" ADD CONSTRAINT "UserTrade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrade" ADD CONSTRAINT "UserTrade_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingOrder" ADD CONSTRAINT "PendingOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
