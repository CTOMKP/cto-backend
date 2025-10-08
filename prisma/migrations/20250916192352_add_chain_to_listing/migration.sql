-- CreateEnum
CREATE TYPE "Chain" AS ENUM ('SOLANA', 'EVM', 'NEAR', 'OSMOSIS', 'OTHER');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "chain" "Chain" NOT NULL DEFAULT 'SOLANA';

-- CreateIndex
CREATE INDEX "Listing_chain_idx" ON "Listing"("chain");
