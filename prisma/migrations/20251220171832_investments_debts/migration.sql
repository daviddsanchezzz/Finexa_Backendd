-- AlterTable
ALTER TABLE "Debt" ADD COLUMN     "expenseSubcategoryId" INTEGER,
ADD COLUMN     "incomeSubcategoryId" INTEGER;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_expenseSubcategoryId_fkey" FOREIGN KEY ("expenseSubcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_incomeSubcategoryId_fkey" FOREIGN KEY ("incomeSubcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
