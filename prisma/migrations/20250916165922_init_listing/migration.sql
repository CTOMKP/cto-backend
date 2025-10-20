-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanResult" (
    "id" SERIAL NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "resultData" JSONB NOT NULL,
    "riskScore" INTEGER,
    "tier" TEXT,
    "summary" TEXT,
    "indexed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER,

    CONSTRAINT "ScanResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "symbol" TEXT,
    "name" TEXT,
    "summary" TEXT,
    "riskScore" INTEGER,
    "tier" TEXT,
    "metadata" JSONB,
    "lastScannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "ScanResult_contractAddress_idx" ON "ScanResult"("contractAddress");

-- CreateIndex
CREATE INDEX "ScanResult_userId_idx" ON "ScanResult"("userId");

-- CreateIndex
CREATE INDEX "ScanResult_riskScore_idx" ON "ScanResult"("riskScore");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_contractAddress_key" ON "Listing"("contractAddress");

-- CreateIndex
CREATE INDEX "Listing_tier_idx" ON "Listing"("tier");

-- CreateIndex
CREATE INDEX "Listing_riskScore_idx" ON "Listing"("riskScore");

-- CreateIndex
CREATE INDEX "Listing_lastScannedAt_idx" ON "Listing"("lastScannedAt");

-- AddForeignKey
ALTER TABLE "ScanResult" ADD CONSTRAINT "ScanResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
