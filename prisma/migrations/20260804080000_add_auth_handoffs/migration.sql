CREATE TABLE "AuthHandoff" (
    "id" SERIAL NOT NULL,
    "codeHash" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthHandoff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthHandoff_codeHash_key" ON "AuthHandoff"("codeHash");
CREATE INDEX "AuthHandoff_userId_idx" ON "AuthHandoff"("userId");
CREATE INDEX "AuthHandoff_expiresAt_idx" ON "AuthHandoff"("expiresAt");

ALTER TABLE "AuthHandoff"
ADD CONSTRAINT "AuthHandoff_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
