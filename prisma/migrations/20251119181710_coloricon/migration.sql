/*
  Warnings:

  - You are about to drop the column `amount` on the `Budget` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `Budget` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Budget` table. All the data in the column will be lost.
  - Added the required column `limit` to the `Budget` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('daily', 'weekly', 'monthly', 'yearly');

-- AlterTable
ALTER TABLE "Budget" DROP COLUMN "amount",
DROP COLUMN "endDate",
DROP COLUMN "type",
ADD COLUMN     "limit" DOUBLE PRECISION NOT NULL,
ADD COLUMN     "period" "BudgetPeriod" NOT NULL DEFAULT 'monthly',
ALTER COLUMN "name" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BudgetPeriodHistory" (
    "id" SERIAL NOT NULL,
    "budgetId" INTEGER NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "spent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetPeriodHistory_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BudgetPeriodHistory" ADD CONSTRAINT "BudgetPeriodHistory_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
