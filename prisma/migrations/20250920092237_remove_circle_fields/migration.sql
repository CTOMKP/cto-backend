/*
  Warnings:

  - You are about to drop the column `circleUserId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `googleId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `walletAddress` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `walletChain` on the `User` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "User_circleUserId_key";

-- DropIndex
DROP INDEX "User_googleId_key";

-- DropIndex
DROP INDEX "User_walletAddress_key";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "circleUserId",
DROP COLUMN "googleId",
DROP COLUMN "walletAddress",
DROP COLUMN "walletChain";
