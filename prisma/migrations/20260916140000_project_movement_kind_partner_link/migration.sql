-- Replace ProjectManualEntry.type (income|expense) + entryKind (standard|profit_distribution)
-- with a single ProjectMovementKind (income|expense|contribution|withdrawal), and replace the
-- free-text partnerName with a real FK to ProjectPartner. Also folds the legacy, never-wired-up
-- ProjectProfitDistribution/Line tables into ProjectManualEntry rows before dropping them, so no
-- historical data is lost even though the app never read from those tables.

-- 1. New enum
CREATE TYPE "ProjectMovementKind" AS ENUM ('income', 'expense', 'contribution', 'withdrawal');

-- 2. New columns (nullable for now, so existing rows keep working while we backfill)
ALTER TABLE "ProjectManualEntry" ADD COLUMN "kind" "ProjectMovementKind";
ALTER TABLE "ProjectManualEntry" ADD COLUMN "partnerId" INTEGER;

-- 3. Backfill kind from the old type/entryKind combo
UPDATE "ProjectManualEntry"
SET "kind" = CASE
  WHEN "type" = 'expense' AND "entryKind" = 'profit_distribution' THEN 'withdrawal'::"ProjectMovementKind"
  WHEN "type" = 'income' THEN 'income'::"ProjectMovementKind"
  ELSE 'expense'::"ProjectMovementKind"
END;

-- 4. Backfill partnerId from partnerName (case-insensitive, trimmed match within the same project)
UPDATE "ProjectManualEntry" pme
SET "partnerId" = pp.id
FROM "ProjectPartner" pp
WHERE pme."projectId" = pp."projectId"
  AND pme."partnerName" IS NOT NULL
  AND LOWER(TRIM(pme."partnerName")) = LOWER(TRIM(pp."name"));

-- 5. kind is now backfilled for every row, make it required
ALTER TABLE "ProjectManualEntry" ALTER COLUMN "kind" SET NOT NULL;

-- 6. Drop old columns/enums now that data has migrated
ALTER TABLE "ProjectManualEntry" DROP COLUMN "type";
ALTER TABLE "ProjectManualEntry" DROP COLUMN "entryKind";
ALTER TABLE "ProjectManualEntry" DROP COLUMN "partnerName";
DROP TYPE "ProjectEntryType";
DROP TYPE "ProjectManualEntryKind";

-- 7. Fold the legacy ProjectProfitDistribution/Line rows into ProjectManualEntry(kind=withdrawal)
--    before dropping those tables, so this historical data survives even though the app never
--    read it through this path.
INSERT INTO "ProjectManualEntry" ("projectId", "kind", "title", "description", "amount", "date", "category", "notes", "partnerId", "createdAt", "updatedAt")
SELECT
  pd."projectId",
  'withdrawal'::"ProjectMovementKind",
  COALESCE(pd."title", 'Reparto de beneficios') || ' · ' || pdl."partnerName",
  pdl."notes",
  pdl."amount",
  pd."date",
  'profit_distribution',
  pd."notes",
  pp.id,
  pdl."createdAt",
  pdl."updatedAt"
FROM "ProjectProfitDistributionLine" pdl
JOIN "ProjectProfitDistribution" pd ON pd.id = pdl."distributionId"
LEFT JOIN "ProjectPartner" pp ON pp."projectId" = pd."projectId" AND LOWER(TRIM(pp."name")) = LOWER(TRIM(pdl."partnerName"));

-- 8. FK + indexes for the new columns
ALTER TABLE "ProjectManualEntry" ADD CONSTRAINT "ProjectManualEntry_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "ProjectPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
DROP INDEX IF EXISTS "ProjectManualEntry_projectId_entryKind_idx";
CREATE INDEX "ProjectManualEntry_projectId_kind_idx" ON "ProjectManualEntry"("projectId", "kind");
CREATE INDEX "ProjectManualEntry_partnerId_idx" ON "ProjectManualEntry"("partnerId");

-- 9. Drop the legacy profit-distribution tables now that their data has been folded in (child first for FK)
DROP TABLE IF EXISTS "ProjectProfitDistributionLine";
DROP TABLE IF EXISTS "ProjectProfitDistribution";
