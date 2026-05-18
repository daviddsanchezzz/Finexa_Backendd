-- Add abbreviation field for user-defined short label shown in portfolio list
ALTER TABLE "InvestmentAsset"
ADD COLUMN "abbreviation" TEXT;
