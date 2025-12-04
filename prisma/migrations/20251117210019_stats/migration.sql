/*
  Warnings:

  - You are about to drop the `ManualMonthBalance` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `finalBalance` to the `ManualMonthData` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ManualMonthBalance" DROP CONSTRAINT "ManualMonthBalance_userId_fkey";

-- AlterTable
ALTER TABLE "ManualMonthData" ADD COLUMN     "finalBalance" DOUBLE PRECISION NOT NULL;

-- DropTable
DROP TABLE "ManualMonthBalance";
