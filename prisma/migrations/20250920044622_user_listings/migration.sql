-- CreateEnum
CREATE TYPE "UserListingStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "UserListing" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "listingId" TEXT,
    "title" TEXT NOT NULL,
    "bio" TEXT NOT NULL,
    "description" TEXT,
    "category" "ListingCategory" NOT NULL DEFAULT 'MEME',
    "contractAddress" TEXT,
    "chain" "Chain",
    "bannerImageId" TEXT,
    "logoImageId" TEXT,
    "galleryImageIds" TEXT[],
    "websiteUrl" TEXT,
    "twitterUrl" TEXT,
    "telegramUrl" TEXT,
    "discordUrl" TEXT,
    "extraLinks" JSONB,
    "status" "UserListingStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedByUserId" INTEGER,
    "rejectionReason" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "likeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserListingRoadmapItem" (
    "id" TEXT NOT NULL,
    "userListingId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "links" JSONB,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserListingRoadmapItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserListing_slug_key" ON "UserListing"("slug");

-- CreateIndex
CREATE INDEX "UserListing_status_idx" ON "UserListing"("status");

-- CreateIndex
CREATE INDEX "UserListing_contractAddress_idx" ON "UserListing"("contractAddress");

-- CreateIndex
CREATE INDEX "UserListing_userId_idx" ON "UserListing"("userId");

-- CreateIndex
CREATE INDEX "UserListingRoadmapItem_userListingId_idx" ON "UserListingRoadmapItem"("userListingId");

-- CreateIndex
CREATE INDEX "UserListingRoadmapItem_order_idx" ON "UserListingRoadmapItem"("order");

-- AddForeignKey
ALTER TABLE "UserListing" ADD CONSTRAINT "UserListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListing" ADD CONSTRAINT "UserListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListingRoadmapItem" ADD CONSTRAINT "UserListingRoadmapItem_userListingId_fkey" FOREIGN KEY ("userListingId") REFERENCES "UserListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
