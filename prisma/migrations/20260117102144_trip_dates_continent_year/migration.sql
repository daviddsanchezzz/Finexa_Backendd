-- CreateEnum
CREATE TYPE "Continent" AS ENUM ('europe', 'africa', 'asia', 'north_america', 'south_america', 'oceania', 'antarctica');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "continent" "Continent",
ADD COLUMN     "year" INTEGER,
ALTER COLUMN "startDate" DROP NOT NULL,
ALTER COLUMN "endDate" DROP NOT NULL;
