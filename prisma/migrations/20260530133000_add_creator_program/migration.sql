-- CreateEnum
CREATE TYPE "CreatorTier" AS ENUM ('STARTER', 'BUILDER', 'PARTNER');

-- CreateEnum
CREATE TYPE "CreatorReferralStatus" AS ENUM ('SIGNED_UP', 'ACTIVE', 'FRAUD_HOLD');

-- CreateEnum
CREATE TYPE "CreatorEarningType" AS ENUM ('LISTING_FEE', 'MARKETPLACE_AD', 'ESCROW_FEE', 'REVENUE_SHARE');

-- CreateEnum
CREATE TYPE "CreatorEarningStatus" AS ENUM ('PENDING', 'AVAILABLE', 'HELD', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "CreatorPayoutStatus" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'PAID', 'REJECTED', 'ON_HOLD');

-- CreateTable
CREATE TABLE "CreatorProgramAccount" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referralLink" TEXT NOT NULL,
    "tier" "CreatorTier" NOT NULL DEFAULT 'STARTER',
    "activeReferralsCount" INTEGER NOT NULL DEFAULT 0,
    "totalReferralsCount" INTEGER NOT NULL DEFAULT 0,
    "totalEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pendingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reservedBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "heldBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payoutWalletAddress" TEXT,
    "fraudStatus" TEXT NOT NULL DEFAULT 'CLEAR',
    "fraudReason" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProgramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorReferral" (
    "id" TEXT NOT NULL,
    "creatorUserId" INTEGER,
    "referredUserId" INTEGER NOT NULL,
    "referralCode" TEXT NOT NULL,
    "referralSource" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "status" "CreatorReferralStatus" NOT NULL DEFAULT 'SIGNED_UP',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isFraudFlagged" BOOLEAN NOT NULL DEFAULT false,
    "fraudReason" TEXT,
    "signedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "firstQualifyingActionType" TEXT,
    "firstQualifyingActionId" TEXT,
    "totalEarned" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorEarning" (
    "id" TEXT NOT NULL,
    "creatorAccountId" TEXT NOT NULL,
    "creatorUserId" INTEGER NOT NULL,
    "referredUserId" INTEGER NOT NULL,
    "sourceType" "CreatorEarningType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "paymentId" TEXT,
    "escrowId" TEXT,
    "amountGross" DOUBLE PRECISION NOT NULL,
    "platformFeeAmount" DOUBLE PRECISION NOT NULL,
    "creatorCutPercent" DOUBLE PRECISION NOT NULL,
    "amountEarned" DOUBLE PRECISION NOT NULL,
    "status" "CreatorEarningStatus" NOT NULL DEFAULT 'PENDING',
    "eventKey" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorEarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreatorPayout" (
    "id" TEXT NOT NULL,
    "creatorAccountId" TEXT NOT NULL,
    "creatorUserId" INTEGER NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "amountRequested" DOUBLE PRECISION NOT NULL,
    "amountApproved" DOUBLE PRECISION,
    "status" "CreatorPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "txHash" TEXT,
    "requestNote" TEXT,
    "reviewedBy" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProgramAccount_userId_key" ON "CreatorProgramAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProgramAccount_referralCode_key" ON "CreatorProgramAccount"("referralCode");

-- CreateIndex
CREATE INDEX "CreatorProgramAccount_tier_idx" ON "CreatorProgramAccount"("tier");

-- CreateIndex
CREATE INDEX "CreatorProgramAccount_fraudStatus_idx" ON "CreatorProgramAccount"("fraudStatus");

-- CreateIndex
CREATE UNIQUE INDEX "CreatorReferral_referredUserId_key" ON "CreatorReferral"("referredUserId");

-- CreateIndex
CREATE INDEX "CreatorReferral_creatorUserId_idx" ON "CreatorReferral"("creatorUserId");

-- CreateIndex
CREATE INDEX "CreatorReferral_status_idx" ON "CreatorReferral"("status");

-- CreateIndex
CREATE INDEX "CreatorReferral_isActive_idx" ON "CreatorReferral"("isActive");

-- CreateIndex
CREATE INDEX "CreatorEarning_creatorUserId_idx" ON "CreatorEarning"("creatorUserId");

-- CreateIndex
CREATE INDEX "CreatorEarning_referredUserId_idx" ON "CreatorEarning"("referredUserId");

-- CreateIndex
CREATE INDEX "CreatorEarning_sourceType_idx" ON "CreatorEarning"("sourceType");

-- CreateIndex
CREATE INDEX "CreatorEarning_status_idx" ON "CreatorEarning"("status");

-- CreateIndex
CREATE INDEX "CreatorEarning_createdAt_idx" ON "CreatorEarning"("createdAt");

-- CreateIndex
CREATE INDEX "CreatorPayout_creatorUserId_idx" ON "CreatorPayout"("creatorUserId");

-- CreateIndex
CREATE INDEX "CreatorPayout_status_idx" ON "CreatorPayout"("status");

-- CreateIndex
CREATE INDEX "CreatorPayout_createdAt_idx" ON "CreatorPayout"("createdAt");

-- AddForeignKey
ALTER TABLE "CreatorProgramAccount" ADD CONSTRAINT "CreatorProgramAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReferral" ADD CONSTRAINT "CreatorReferral_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorReferral" ADD CONSTRAINT "CreatorReferral_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_creatorAccountId_fkey" FOREIGN KEY ("creatorAccountId") REFERENCES "CreatorProgramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_referredUserId_fkey" FOREIGN KEY ("referredUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorEarning" ADD CONSTRAINT "CreatorEarning_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPayout" ADD CONSTRAINT "CreatorPayout_creatorAccountId_fkey" FOREIGN KEY ("creatorAccountId") REFERENCES "CreatorProgramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPayout" ADD CONSTRAINT "CreatorPayout_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorPayout" ADD CONSTRAINT "CreatorPayout_reviewedBy_fkey" FOREIGN KEY ("reviewedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
