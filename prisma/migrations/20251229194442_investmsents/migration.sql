/*
  Warnings:

  - You are about to drop the column `symbol` on the `InvestmentAsset` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "InvestmentRiskType" AS ENUM ('fixed_income', 'variable_income');

-- AlterTable
ALTER TABLE "InvestmentAsset" DROP COLUMN "symbol",
ADD COLUMN     "description" TEXT,
ADD COLUMN     "riskType" "InvestmentRiskType";
