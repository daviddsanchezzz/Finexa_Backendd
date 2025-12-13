-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('cash', 'investment');

-- CreateEnum
CREATE TYPE "InvestmentAssetType" AS ENUM ('crypto', 'etf', 'stock', 'fund', 'custom');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "investmentAssetId" INTEGER;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "kind" "WalletKind" NOT NULL DEFAULT 'cash';

-- CreateTable
CREATE TABLE "InvestmentAsset" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "type" "InvestmentAssetType" NOT NULL DEFAULT 'custom',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InvestmentAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvestmentValuationSnapshot" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InvestmentValuationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentAsset_userId_name_key" ON "InvestmentAsset"("userId", "name");

-- CreateIndex
CREATE INDEX "InvestmentValuationSnapshot_userId_date_idx" ON "InvestmentValuationSnapshot"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "InvestmentValuationSnapshot_userId_assetId_date_key" ON "InvestmentValuationSnapshot"("userId", "assetId", "date");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_investmentAssetId_fkey" FOREIGN KEY ("investmentAssetId") REFERENCES "InvestmentAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentAsset" ADD CONSTRAINT "InvestmentAsset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentValuationSnapshot" ADD CONSTRAINT "InvestmentValuationSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvestmentValuationSnapshot" ADD CONSTRAINT "InvestmentValuationSnapshot_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "InvestmentAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
