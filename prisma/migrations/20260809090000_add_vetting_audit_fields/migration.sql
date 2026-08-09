-- Add chain-aware scan audit fields without changing existing API identifiers.
ALTER TABLE "ScanResult"
ADD COLUMN "chain" "Chain",
ADD COLUMN "status" TEXT NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN "scoringVersion" TEXT,
ADD COLUMN "scoreDirection" TEXT,
ADD COLUMN "dataSufficient" BOOLEAN,
ADD COLUMN "missingData" JSONB,
ADD COLUMN "providerSnapshot" JSONB,
ADD COLUMN "failureReason" TEXT,
ADD COLUMN "completedAt" TIMESTAMP(3);

ALTER TABLE "Listing"
ADD COLUMN "lastVettedAt" TIMESTAMP(3),
ADD COLUMN "lastMonitoredAt" TIMESTAMP(3),
ADD COLUMN "nextScanAt" TIMESTAMP(3),
ADD COLUMN "scoringVersion" TEXT,
ADD COLUMN "dataSufficient" BOOLEAN;

CREATE INDEX "ScanResult_contractAddress_chain_createdAt_idx"
ON "ScanResult"("contractAddress", "chain", "createdAt");

CREATE INDEX "ScanResult_status_createdAt_idx"
ON "ScanResult"("status", "createdAt");

CREATE INDEX "Listing_vetted_nextScanAt_idx"
ON "Listing"("vetted", "nextScanAt");

CREATE TABLE "JobLease" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobLease_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "JobLease_expiresAt_idx" ON "JobLease"("expiresAt");

CREATE TABLE "ScanJob" (
    "id" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "chain" "Chain" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScanJob_status_runAfter_idx" ON "ScanJob"("status", "runAfter");
CREATE INDEX "ScanJob_contractAddress_chain_status_idx" ON "ScanJob"("contractAddress", "chain", "status");

-- Reconcile existing add-on rows with the approved marketplace specification.
UPDATE "MarketplacePricing" SET "amount" = 20 WHERE "kind" = 'ADDON' AND "key" = 'FEATURED_PLACEMENT';
UPDATE "MarketplacePricing" SET "amount" = 35 WHERE "kind" = 'ADDON' AND "key" = 'HOMEPAGE_SPOTLIGHT';
UPDATE "MarketplacePricing" SET "amount" = 3 WHERE "kind" = 'ADDON' AND "key" = 'AUTO_BUMP_1';
UPDATE "MarketplacePricing" SET "amount" = 7 WHERE "kind" = 'ADDON' AND "key" = 'AUTO_BUMP_3';
UPDATE "MarketplacePricing" SET "amount" = 15 WHERE "kind" = 'ADDON' AND "key" = 'AUTO_BUMP_7';
UPDATE "MarketplacePricing" SET "amount" = 5 WHERE "kind" = 'ADDON' AND "key" = 'MULTI_CHAIN_TAG';
UPDATE "MarketplacePricing" SET "amount" = 5 WHERE "kind" = 'ADDON' AND "key" = 'URGENT_TAG';

ALTER TABLE "MarketplaceAd"
ADD COLUMN "baseListingFeeUsd" DECIMAL(12,2),
ADD COLUMN "addOnsFeeUsd" DECIMAL(12,2),
ADD COLUMN "pricingVersion" TEXT,
ADD COLUMN "spotlightUntil" TIMESTAMP(3),
ADD COLUMN "lastBumpedAt" TIMESTAMP(3),
ADD COLUMN "nextAutoBumpAt" TIMESTAMP(3),
ADD COLUMN "autoBumpEndsAt" TIMESTAMP(3);

CREATE INDEX "MarketplaceAd_nextAutoBumpAt_idx" ON "MarketplaceAd"("nextAutoBumpAt");
