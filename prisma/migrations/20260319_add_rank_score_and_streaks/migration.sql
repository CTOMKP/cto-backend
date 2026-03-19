ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "rankScore" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "rankTier" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "currentStreakDays" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastLoginDate" TIMESTAMP(3);

ALTER TABLE "XpTransaction"
  ADD COLUMN IF NOT EXISTS "eventKey" TEXT;

CREATE TABLE IF NOT EXISTS "RankScoreTransaction" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "rankScoreAfter" INTEGER NOT NULL,
  "eventKey" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RankScoreTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RankScoreTransaction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "RankScoreTransaction_userId_idx" ON "RankScoreTransaction"("userId");
CREATE INDEX IF NOT EXISTS "RankScoreTransaction_createdAt_idx" ON "RankScoreTransaction"("createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "RankScoreTransaction_eventKey_key" ON "RankScoreTransaction"("eventKey");
CREATE UNIQUE INDEX IF NOT EXISTS "XpTransaction_eventKey_key" ON "XpTransaction"("eventKey");
