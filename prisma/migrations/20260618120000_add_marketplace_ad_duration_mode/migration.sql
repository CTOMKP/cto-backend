-- Marketplace ad duration mode lets creators choose between singular and recurring job ads.
CREATE TYPE "MarketplaceAdDurationMode" AS ENUM ('SINGULAR', 'RECURRING');

ALTER TABLE "MarketplaceAd"
ADD COLUMN "durationMode" "MarketplaceAdDurationMode" NOT NULL DEFAULT 'SINGULAR';
