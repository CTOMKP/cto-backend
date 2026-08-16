CREATE TABLE "MascotAssignment" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "mascotKey" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MascotAssignment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MascotAssignment_userId_key" ON "MascotAssignment"("userId");
CREATE INDEX "MascotAssignment_mascotKey_idx" ON "MascotAssignment"("mascotKey");

ALTER TABLE "MascotAssignment" ADD CONSTRAINT "MascotAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
