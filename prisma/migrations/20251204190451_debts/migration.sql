-- CreateEnum
CREATE TYPE "DebtType" AS ENUM ('loan', 'personal');

-- CreateEnum
CREATE TYPE "DebtDirection" AS ENUM ('i_ow', 'they_owe');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('active', 'paid', 'closed');

-- CreateTable
CREATE TABLE "Debt" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" "DebtType" NOT NULL DEFAULT 'loan',
    "direction" "DebtDirection" NOT NULL DEFAULT 'i_ow',
    "status" "DebtStatus" NOT NULL DEFAULT 'active',
    "name" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "emoji" TEXT,
    "color" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "payed" DOUBLE PRECISION DEFAULT 0,
    "remainingAmount" DOUBLE PRECISION NOT NULL,
    "interestRate" DOUBLE PRECISION,
    "monthlyPayment" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "nextDueDate" TIMESTAMP(3),
    "installmentsPaid" INTEGER DEFAULT 0,
    "subcategoryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Debt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Debt_userId_idx" ON "Debt"("userId");

-- CreateIndex
CREATE INDEX "Debt_subcategoryId_idx" ON "Debt"("subcategoryId");

-- CreateIndex
CREATE INDEX "Transaction_subcategoryId_idx" ON "Transaction"("subcategoryId");

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Debt" ADD CONSTRAINT "Debt_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "Subcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
