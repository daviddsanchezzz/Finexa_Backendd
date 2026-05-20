-- CreateTable
CREATE TABLE "InvestmentTargetAllocation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "targetPct" DECIMAL(7,4) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvestmentTargetAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentTargetAllocation_userId_assetId_key" ON "InvestmentTargetAllocation"("userId", "assetId");

-- CreateIndex
CREATE INDEX "InvestmentTargetAllocation_userId_active_idx" ON "InvestmentTargetAllocation"("userId", "active");

-- CreateIndex
CREATE INDEX "InvestmentTargetAllocation_assetId_active_idx" ON "InvestmentTargetAllocation"("assetId", "active");

-- AddForeignKey
ALTER TABLE "InvestmentTargetAllocation" ADD CONSTRAINT "InvestmentTargetAllocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentTargetAllocation" ADD CONSTRAINT "InvestmentTargetAllocation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InvestmentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
