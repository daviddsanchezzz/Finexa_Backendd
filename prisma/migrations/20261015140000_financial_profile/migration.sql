-- CreateTable
CREATE TABLE "FinancialProfile" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "birthYear" INTEGER,
    "incomeType" TEXT,
    "dependents" INTEGER,
    "riskTolerance" INTEGER,
    "emergencyMonthsTarget" INTEGER,
    "fiTargetMultiple" INTEGER,
    "fiTargetAge" INTEGER,
    "expectedRealReturnPct" DECIMAL(4,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfile_userId_key" ON "FinancialProfile"("userId");

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

