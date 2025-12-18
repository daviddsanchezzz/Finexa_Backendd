-- CreateEnum
CREATE TYPE "AllocationCategory" AS ENUM ('expense', 'investment', 'savings');

-- CreateTable
CREATE TABLE "AllocationPlan" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "income" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationItem" (
    "id" SERIAL NOT NULL,
    "planId" INTEGER NOT NULL,
    "category" "AllocationCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllocationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AllocationPlan_userId_key" ON "AllocationPlan"("userId");

-- CreateIndex
CREATE INDEX "AllocationPlan_userId_idx" ON "AllocationPlan"("userId");

-- CreateIndex
CREATE INDEX "AllocationItem_planId_category_idx" ON "AllocationItem"("planId", "category");

-- AddForeignKey
ALTER TABLE "AllocationItem" ADD CONSTRAINT "AllocationItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AllocationPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
