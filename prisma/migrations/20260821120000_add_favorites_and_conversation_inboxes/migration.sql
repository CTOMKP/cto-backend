-- Persistent user favorites and independent General/Marketplace inbox state.
-- Quote every Prisma identifier because PostgreSQL otherwise folds it to lowercase.
BEGIN;

-- Clean up types that an earlier failed, unquoted attempt may have left behind.
DROP TYPE IF EXISTS favoritetargettype;
DROP TYPE IF EXISTS conversationtype;

CREATE TYPE "FavoriteTargetType" AS ENUM ('TOKEN', 'USER_LISTING', 'MARKETPLACE_AD');
CREATE TYPE "ConversationType" AS ENUM ('GENERAL', 'MARKETPLACE');

ALTER TABLE "Conversation"
  ADD COLUMN "type" "ConversationType" NOT NULL DEFAULT 'MARKETPLACE',
  ADD COLUMN "directKey" TEXT,
  ALTER COLUMN "adId" DROP NOT NULL;

CREATE UNIQUE INDEX "Conversation_directKey_key" ON "Conversation"("directKey");
CREATE INDEX "Conversation_type_idx" ON "Conversation"("type");

CREATE TABLE "ConversationParticipantState" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationParticipantState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationParticipantState_conversationId_userId_key"
  ON "ConversationParticipantState"("conversationId", "userId");
CREATE INDEX "ConversationParticipantState_userId_archivedAt_idx"
  ON "ConversationParticipantState"("userId", "archivedAt");

ALTER TABLE "ConversationParticipantState"
  ADD CONSTRAINT "ConversationParticipantState_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipantState"
  ADD CONSTRAINT "ConversationParticipantState_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve existing marketplace conversations and their legacy archive state.
INSERT INTO "ConversationParticipantState"
  ("id", "conversationId", "userId", "archivedAt", "createdAt", "updatedAt")
SELECT
  CONCAT('cps_', md5(c."id" || ':' || participants."userId"::text)),
  c."id",
  participants."userId",
  CASE WHEN c."status" = 'ARCHIVED' THEN CURRENT_TIMESTAMP ELSE NULL END,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Conversation" AS c
CROSS JOIN LATERAL (
  VALUES (c."posterId"), (c."applicantId")
) AS participants("userId")
ON CONFLICT ("conversationId", "userId") DO NOTHING;

UPDATE "Conversation" SET "status" = 'ACTIVE' WHERE "status" = 'ARCHIVED';

CREATE TABLE "Favorite" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "targetType" "FavoriteTargetType" NOT NULL,
  "targetId" TEXT NOT NULL,
  "targetKey" TEXT NOT NULL,
  "chain" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Favorite_userId_targetType_targetKey_key"
  ON "Favorite"("userId", "targetType", "targetKey");
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId", "createdAt");
CREATE INDEX "Favorite_targetType_targetKey_idx" ON "Favorite"("targetType", "targetKey");

ALTER TABLE "Favorite"
  ADD CONSTRAINT "Favorite_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
