/*
  Warnings:

  - You are about to drop the column `type` on the `Wallet` table. All the data in the column will be lost.
  - Added the required column `emoji` to the `Wallet` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "type",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "emoji" TEXT NOT NULL;
