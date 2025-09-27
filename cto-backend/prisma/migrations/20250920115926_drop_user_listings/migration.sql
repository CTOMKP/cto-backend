/*
  Warnings:

  - You are about to drop the `UserListing` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UserListingRoadmapItem` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UserListing" DROP CONSTRAINT "UserListing_listingId_fkey";

-- DropForeignKey
ALTER TABLE "UserListing" DROP CONSTRAINT "UserListing_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserListingRoadmapItem" DROP CONSTRAINT "UserListingRoadmapItem_userListingId_fkey";

-- DropTable
DROP TABLE "UserListing";

-- DropTable
DROP TABLE "UserListingRoadmapItem";

-- DropEnum
DROP TYPE "UserListingStatus";
