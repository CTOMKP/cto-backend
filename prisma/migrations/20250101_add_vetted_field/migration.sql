-- AlterTable (idempotent: only add column if it doesn't exist)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'Listing' 
        AND column_name = 'vetted'
    ) THEN
        ALTER TABLE "Listing" ADD COLUMN "vetted" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Update existing tokens: if they have a riskScore, they've been vetted
UPDATE "Listing" SET "vetted" = true WHERE "riskScore" IS NOT NULL AND "vetted" = false;

