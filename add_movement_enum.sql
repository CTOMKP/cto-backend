-- Add MOVEMENT to Chain enum
BEGIN;

-- Create new enum with MOVEMENT added
CREATE TYPE "Chain_new" AS ENUM ('SOLANA', 'ETHEREUM', 'BSC', 'SUI', 'BASE', 'APTOS', 'MOVEMENT', 'NEAR', 'OSMOSIS', 'OTHER', 'UNKNOWN');

-- Update Listing table
ALTER TABLE "Listing" ALTER COLUMN "chain" DROP DEFAULT;
ALTER TABLE "Listing" ALTER COLUMN "chain" TYPE "Chain_new" USING ("chain"::text::"Chain_new");
ALTER TABLE "Listing" ALTER COLUMN "chain" SET DEFAULT 'SOLANA';

-- Update Wallet table (if it exists and uses blockchain column)
ALTER TABLE "Wallet" ALTER COLUMN "blockchain" TYPE "Chain_new" USING ("blockchain"::text::"Chain_new");

-- Replace old enum with new one
ALTER TYPE "Chain" RENAME TO "Chain_old";
ALTER TYPE "Chain_new" RENAME TO "Chain";
DROP TYPE "Chain_old";

COMMIT;

