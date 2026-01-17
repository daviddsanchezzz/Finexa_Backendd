/*
  Warnings:

  - You are about to drop the column `emoji` on the `Trip` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('wishlist', 'planning', 'seen');

-- AlterTable
ALTER TABLE "Trip" DROP COLUMN "emoji",
ADD COLUMN     "status" "TripStatus" NOT NULL DEFAULT 'wishlist';
