/*
  Warnings:

  - The values [EVM] on the enum `Chain` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Chain_new" AS ENUM ('SOLANA', 'ETHEREUM', 'BSC', 'SUI', 'BASE', 'APTOS', 'NEAR', 'OSMOSIS', 'OTHER', 'UNKNOWN');
ALTER TABLE "Listing" ALTER COLUMN "chain" DROP DEFAULT;
ALTER TABLE "Listing" ALTER COLUMN "chain" TYPE "Chain_new" USING ("chain"::text::"Chain_new");
ALTER TYPE "Chain" RENAME TO "Chain_old";
ALTER TYPE "Chain_new" RENAME TO "Chain";
DROP TYPE "Chain_old";
ALTER TABLE "Listing" ALTER COLUMN "chain" SET DEFAULT 'SOLANA';
COMMIT;
