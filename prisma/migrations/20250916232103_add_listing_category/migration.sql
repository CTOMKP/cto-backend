-- CreateEnum
CREATE TYPE "ListingCategory" AS ENUM ('MEME', 'DEFI', 'NFT', 'OTHER', 'UNKNOWN');

-- AlterEnum
ALTER TYPE "Chain" ADD VALUE 'BASE';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "category" "ListingCategory" NOT NULL DEFAULT 'MEME';

-- CreateIndex
CREATE INDEX "Listing_category_idx" ON "Listing"("category");
