-- Escrow, messaging, XP, notifications additions

DO $$ BEGIN
  CREATE TYPE "ConversationStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "MessageType" AS ENUM ('COVER_LETTER', 'MESSAGE', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "EscrowStatus" AS ENUM (
    'PROPOSED',
    'AWAITING_PAYMENT',
    'FUNDED_ACTIVE',
    'UNDER_REVIEW',
    'COMPLETED',
    'DECLINED',
    'CANCELLED',
    'REFUNDED',
    'DISPUTED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationType" AS ENUM (
    'MESSAGE',
    'ESCROW',
    'XP',
    'PAYMENT',
    'LISTING_APPROVAL',
    'AD_APPROVAL',
    'SYSTEM'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "xpBalance" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastDailyXpAt" TIMESTAMP;

ALTER TABLE "MarketplaceAd"
  ADD COLUMN IF NOT EXISTS "viewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "messageCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastInteractionAt" TIMESTAMP;

CREATE TABLE IF NOT EXISTS "Conversation" (
  "id" TEXT PRIMARY KEY,
  "adId" TEXT NOT NULL,
  "posterId" INTEGER NOT NULL,
  "applicantId" INTEGER NOT NULL,
  "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastMessageAt" TIMESTAMP,
  "lastMessagePreview" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "Conversation_adId_applicantId_key" ON "Conversation"("adId", "applicantId");
CREATE INDEX IF NOT EXISTS "Conversation_posterId_idx" ON "Conversation"("posterId");
CREATE INDEX IF NOT EXISTS "Conversation_applicantId_idx" ON "Conversation"("applicantId");
CREATE INDEX IF NOT EXISTS "Conversation_adId_idx" ON "Conversation"("adId");

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketplaceAd"("id") ON DELETE CASCADE;
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT PRIMARY KEY,
  "conversationId" TEXT NOT NULL,
  "senderId" INTEGER NOT NULL,
  "receiverId" INTEGER NOT NULL,
  "type" "MessageType" NOT NULL DEFAULT 'MESSAGE',
  "body" TEXT NOT NULL,
  "readAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Message_conversationId_idx" ON "Message"("conversationId");
CREATE INDEX IF NOT EXISTS "Message_senderId_idx" ON "Message"("senderId");
CREATE INDEX IF NOT EXISTS "Message_receiverId_idx" ON "Message"("receiverId");
CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt");

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE;
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "Escrow" (
  "id" TEXT PRIMARY KEY,
  "adId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "posterId" INTEGER NOT NULL,
  "applicantId" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "totalAmount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USDC',
  "deadline" TIMESTAMP,
  "noDeadline" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "EscrowStatus" NOT NULL DEFAULT 'PROPOSED',
  "isFrozen" BOOLEAN NOT NULL DEFAULT FALSE,
  "flaggedReason" TEXT,
  "disputeReason" TEXT,
  "proposedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "acceptedAt" TIMESTAMP,
  "fundedAt" TIMESTAMP,
  "submittedAt" TIMESTAMP,
  "completedAt" TIMESTAMP,
  "cancelledAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Escrow_posterId_idx" ON "Escrow"("posterId");
CREATE INDEX IF NOT EXISTS "Escrow_applicantId_idx" ON "Escrow"("applicantId");
CREATE INDEX IF NOT EXISTS "Escrow_status_idx" ON "Escrow"("status");
CREATE INDEX IF NOT EXISTS "Escrow_adId_idx" ON "Escrow"("adId");

ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketplaceAd"("id") ON DELETE CASCADE;
ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE;
ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_posterId_fkey" FOREIGN KEY ("posterId") REFERENCES "User"("id") ON DELETE CASCADE;
ALTER TABLE "Escrow"
  ADD CONSTRAINT "Escrow_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "User"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "EscrowMilestone" (
  "id" TEXT PRIMARY KEY,
  "escrowId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "dueDate" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "EscrowMilestone_escrowId_idx" ON "EscrowMilestone"("escrowId");
ALTER TABLE "EscrowMilestone"
  ADD CONSTRAINT "EscrowMilestone_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "XpTransaction" (
  "id" TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "XpTransaction_userId_idx" ON "XpTransaction"("userId");
CREATE INDEX IF NOT EXISTS "XpTransaction_createdAt_idx" ON "XpTransaction"("createdAt");
ALTER TABLE "XpTransaction"
  ADD CONSTRAINT "XpTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT PRIMARY KEY,
  "userId" INTEGER NOT NULL,
  "type" "NotificationType" NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "data" JSONB,
  "readAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "Notification_userId_idx" ON "Notification"("userId");
CREATE INDEX IF NOT EXISTS "Notification_createdAt_idx" ON "Notification"("createdAt");
CREATE INDEX IF NOT EXISTS "Notification_type_idx" ON "Notification"("type");
ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "MarketplaceAdInteraction" (
  "id" TEXT PRIMARY KEY,
  "adId" TEXT NOT NULL,
  "userId" INTEGER,
  "type" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "MarketplaceAdInteraction_adId_idx" ON "MarketplaceAdInteraction"("adId");
CREATE INDEX IF NOT EXISTS "MarketplaceAdInteraction_userId_idx" ON "MarketplaceAdInteraction"("userId");
CREATE INDEX IF NOT EXISTS "MarketplaceAdInteraction_type_idx" ON "MarketplaceAdInteraction"("type");
CREATE INDEX IF NOT EXISTS "MarketplaceAdInteraction_createdAt_idx" ON "MarketplaceAdInteraction"("createdAt");

ALTER TABLE "MarketplaceAdInteraction"
  ADD CONSTRAINT "MarketplaceAdInteraction_adId_fkey" FOREIGN KEY ("adId") REFERENCES "MarketplaceAd"("id") ON DELETE CASCADE;
ALTER TABLE "MarketplaceAdInteraction"
  ADD CONSTRAINT "MarketplaceAdInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

ALTER TABLE "Payment"
  ADD COLUMN IF NOT EXISTS "escrowId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_escrowId_fkey" FOREIGN KEY ("escrowId") REFERENCES "Escrow"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
