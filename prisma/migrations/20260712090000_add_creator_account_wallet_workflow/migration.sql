ALTER TABLE "CreatorProgramAccount"
ADD COLUMN IF NOT EXISTS "payoutWalletChangePendingAddress" TEXT,
ADD COLUMN IF NOT EXISTS "payoutWalletLastChangedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "payoutWalletChangePendingUntil" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "nextPayoutWalletChangeAllowedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "isDeactivated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMP(3);
