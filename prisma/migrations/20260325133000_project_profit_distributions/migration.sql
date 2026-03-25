-- CreateTable
CREATE TABLE "ProjectProfitDistribution" (
    "id" SERIAL NOT NULL,
    "projectId" INTEGER NOT NULL,
    "title" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectProfitDistribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectProfitDistributionLine" (
    "id" SERIAL NOT NULL,
    "distributionId" INTEGER NOT NULL,
    "partnerName" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "percentage" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectProfitDistributionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectProfitDistribution_projectId_date_idx" ON "ProjectProfitDistribution"("projectId", "date");

-- CreateIndex
CREATE INDEX "ProjectProfitDistributionLine_distributionId_idx" ON "ProjectProfitDistributionLine"("distributionId");

-- AddForeignKey
ALTER TABLE "ProjectProfitDistribution" ADD CONSTRAINT "ProjectProfitDistribution_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectProfitDistributionLine" ADD CONSTRAINT "ProjectProfitDistributionLine_distributionId_fkey" FOREIGN KEY ("distributionId") REFERENCES "ProjectProfitDistribution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
