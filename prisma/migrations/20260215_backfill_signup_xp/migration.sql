-- Backfill signup XP for existing users who never received it
WITH eligible AS (
  SELECT u.id, COALESCE(u."xpBalance", 0) AS balance
  FROM "User" u
  WHERE NOT EXISTS (
    SELECT 1 FROM "XpTransaction" x
    WHERE x."userId" = u.id AND x."reason" = 'signup'
  )
)
UPDATE "User" u
SET "xpBalance" = e.balance + 8
FROM eligible e
WHERE u.id = e.id;

INSERT INTO "XpTransaction" ("id", "userId", "type", "reason", "amount", "balanceAfter", "metadata", "createdAt")
SELECT
  md5(random()::text || clock_timestamp()::text || e.id::text),
  e.id,
  'EARN',
  'signup',
  8,
  e.balance + 8,
  '{"source":"backfill"}'::jsonb,
  NOW()
FROM eligible e;
