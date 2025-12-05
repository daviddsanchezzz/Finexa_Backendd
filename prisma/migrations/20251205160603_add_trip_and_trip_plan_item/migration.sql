/*
  Warnings:

  - You are about to drop the column `color` on the `Trip` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Trip" DROP COLUMN "color",
ADD COLUMN     "budget" DOUBLE PRECISION;
