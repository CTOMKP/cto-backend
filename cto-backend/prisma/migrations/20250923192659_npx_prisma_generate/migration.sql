-- CreateTable
CREATE TABLE "UserListing" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "contractAddr" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bio" TEXT,
    "logoUrl" TEXT,
    "bannerUrl" TEXT,
    "links" JSONB,
    "status" TEXT NOT NULL,
    "vettingTier" TEXT NOT NULL,
    "vettingScore" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdBoost" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdBoost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserListing_status_idx" ON "UserListing"("status");

-- CreateIndex
CREATE INDEX "UserListing_userId_idx" ON "UserListing"("userId");

-- CreateIndex
CREATE INDEX "AdBoost_listingId_idx" ON "AdBoost"("listingId");

-- AddForeignKey
ALTER TABLE "UserListing" ADD CONSTRAINT "UserListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdBoost" ADD CONSTRAINT "AdBoost_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "UserListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
