-- CreateTable
CREATE TABLE "MonitoringSnapshot" (
    "id" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentTier" TEXT,
    "price" DOUBLE PRECISION DEFAULT 0,
    "marketCap" DOUBLE PRECISION DEFAULT 0,
    "liquidity" DOUBLE PRECISION DEFAULT 0,
    "volume24h" DOUBLE PRECISION DEFAULT 0,
    "priceChange24h" DOUBLE PRECISION DEFAULT 0,
    "totalHolders" INTEGER DEFAULT 0,
    "holderChange24h" INTEGER DEFAULT 0,
    "topHolderPct" DOUBLE PRECISION DEFAULT 0,
    "top10HoldersPct" DOUBLE PRECISION DEFAULT 0,
    "txns24h" INTEGER DEFAULT 0,
    "buys24h" INTEGER DEFAULT 0,
    "sells24h" INTEGER DEFAULT 0,
    "uniqueWallets24h" INTEGER DEFAULT 0,
    "liquidityTrend" TEXT,
    "holderTrend" TEXT,
    "activityTrend" TEXT,
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "triggerType" TEXT NOT NULL,
    "conditionDescription" TEXT,
    "actionTaken" TEXT,
    "message" TEXT,
    "detected" BOOLEAN NOT NULL DEFAULT true,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonitoringSnapshot_contractAddress_idx" ON "MonitoringSnapshot"("contractAddress");

-- CreateIndex
CREATE INDEX "MonitoringSnapshot_scannedAt_idx" ON "MonitoringSnapshot"("scannedAt");

-- CreateIndex
CREATE INDEX "Alert_contractAddress_idx" ON "Alert"("contractAddress");

-- CreateIndex
CREATE INDEX "Alert_severity_idx" ON "Alert"("severity");

-- CreateIndex
CREATE INDEX "Alert_triggerType_idx" ON "Alert"("triggerType");

-- CreateIndex
CREATE INDEX "Alert_detected_idx" ON "Alert"("detected");

-- CreateIndex
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");

