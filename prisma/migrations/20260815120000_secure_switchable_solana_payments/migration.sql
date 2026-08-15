ALTER TABLE "Payment"
  ADD COLUMN "network" TEXT,
  ADD COLUMN "tokenAddress" TEXT,
  ADD COLUMN "amountAtomic" TEXT,
  ADD COLUMN "fromAddress" TEXT,
  ADD COLUMN "quotedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Payment_txHash_key" ON "Payment"("txHash");
CREATE INDEX "Payment_network_status_idx" ON "Payment"("network", "status");
