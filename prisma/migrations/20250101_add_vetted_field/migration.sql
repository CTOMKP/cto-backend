-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "vetted" BOOLEAN NOT NULL DEFAULT false;

-- Update existing tokens: if they have a riskScore, they've been vetted
UPDATE "Listing" SET "vetted" = true WHERE "riskScore" IS NOT NULL;

