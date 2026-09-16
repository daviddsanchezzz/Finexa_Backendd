-- AlterEnum
ALTER TYPE "DebtType" ADD VALUE 'mortgage';
ALTER TYPE "DebtType" ADD VALUE 'credit_card';
ALTER TYPE "DebtType" ADD VALUE 'other';

-- CreateEnum
CREATE TYPE "DebtPaymentFrequency" AS ENUM ('weekly', 'monthly', 'quarterly', 'yearly');

-- AlterTable
ALTER TABLE "Debt"
  ALTER COLUMN "entity" DROP NOT NULL,
  ADD COLUMN "paymentFrequency" "DebtPaymentFrequency",
  ADD COLUMN "expectedEndDate" TIMESTAMP(3),
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "walletId" INTEGER,
  ADD COLUMN "autoRecurringEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "recurringTransactionId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Debt_recurringTransactionId_key" ON "Debt"("recurringTransactionId");
CREATE INDEX "Debt_walletId_idx" ON "Debt"("walletId");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_recurringTransactionId_fkey" FOREIGN KEY ("recurringTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
