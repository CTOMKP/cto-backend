-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "lpBurnedPercentage" DOUBLE PRECISION,
ADD COLUMN     "mintAuthDisabled" BOOLEAN,
ADD COLUMN     "raidingDetected" BOOLEAN,
ADD COLUMN     "top10HoldersPercentage" DOUBLE PRECISION;
