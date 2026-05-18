-- Add symbol field to investment assets
ALTER TABLE "InvestmentAsset"
ADD COLUMN IF NOT EXISTS "symbol" TEXT;

-- Latest metadata snapshot per investment asset
CREATE TABLE IF NOT EXISTS "AssetMetadata" (
  "id" SERIAL PRIMARY KEY,
  "assetId" INTEGER NOT NULL UNIQUE,
  "isin" TEXT,
  "fmpSymbol" TEXT,
  "provider" TEXT NOT NULL DEFAULT 'fmp',
  "currency" TEXT,
  "countriesJson" JSONB,
  "sectorsJson" JSONB,
  "topHoldingsJson" JSONB,
  "cryptoCategory" TEXT,
  "source" TEXT,
  "lastError" TEXT,
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "AssetMetadata_fmpSymbol_idx" ON "AssetMetadata"("fmpSymbol");
CREATE INDEX IF NOT EXISTS "AssetMetadata_provider_idx" ON "AssetMetadata"("provider");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'AssetMetadata_assetId_fkey'
  ) THEN
    ALTER TABLE "AssetMetadata"
    ADD CONSTRAINT "AssetMetadata_assetId_fkey"
    FOREIGN KEY ("assetId") REFERENCES "InvestmentAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
