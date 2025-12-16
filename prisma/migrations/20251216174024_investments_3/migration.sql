/*
  Warnings:

  - You are about to drop the `BudgetPeriodHistory` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BudgetPeriodHistory" DROP CONSTRAINT "BudgetPeriodHistory_budgetId_fkey";

-- DropTable
DROP TABLE "BudgetPeriodHistory";

-- CreateTable
CREATE TABLE "MonthlyReport" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "month" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MonthlyReport_userId_month_idx" ON "MonthlyReport"("userId", "month");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReport_userId_month_key" ON "MonthlyReport"("userId", "month");
