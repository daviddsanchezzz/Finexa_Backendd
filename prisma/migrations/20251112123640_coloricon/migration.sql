/*
  Warnings:

  - You are about to drop the column `icon` on the `Category` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Category" DROP COLUMN "icon",
ADD COLUMN     "color" TEXT,
ADD COLUMN     "emoji" TEXT;

-- AlterTable
ALTER TABLE "Subcategory" ADD COLUMN     "color" TEXT,
ADD COLUMN     "emoji" TEXT;
