-- DropForeignKey
ALTER TABLE "AdBoost" DROP CONSTRAINT "AdBoost_listingId_fkey";

-- DropForeignKey
ALTER TABLE "Meme" DROP CONSTRAINT "Meme_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_userId_fkey";

-- DropForeignKey
ALTER TABLE "ScanResult" DROP CONSTRAINT "ScanResult_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserListing" DROP CONSTRAINT "UserListing_userId_fkey";

-- DropForeignKey
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_userId_fkey";

-- AddForeignKey
ALTER TABLE "ScanResult" ADD CONSTRAINT "ScanResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListing" ADD CONSTRAINT "UserListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdBoost" ADD CONSTRAINT "AdBoost_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "UserListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meme" ADD CONSTRAINT "Meme_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
