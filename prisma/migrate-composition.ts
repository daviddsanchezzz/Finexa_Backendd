/**
 * Data migration: populates InvestmentAssetRegion / InvestmentAssetSector /
 * InvestmentAssetHolding from the existing AssetMetadata JSON blobs.
 *
 * Run once after `prisma migrate dev --name add_composition_tables`:
 *   npx ts-node prisma/migrate-composition.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const metas = await prisma.assetMetadata.findMany({
    select: { assetId: true, countriesJson: true, sectorsJson: true, topHoldingsJson: true },
  });

  console.log(`Found ${metas.length} AssetMetadata rows to process.`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const meta of metas) {
    const { assetId } = meta;

    try {
      // Skip assets that already have normalized data
      const existingCount = await prisma.investmentAssetRegion.count({ where: { assetId } });
      if (existingCount > 0) {
        skipped++;
        continue;
      }

      const countries = meta.countriesJson as Record<string, number> | null;
      const sectors = meta.sectorsJson as Record<string, number> | null;
      const holdings = meta.topHoldingsJson as Array<{ name: string; ticker?: string | null; weight: number }> | null;

      const ops: any[] = [];

      if (countries && Object.keys(countries).length > 0) {
        ops.push(
          prisma.investmentAssetRegion.createMany({
            data: Object.entries(countries).map(([country, pct]) => ({ assetId, country, pct })),
            skipDuplicates: true,
          }),
        );
      }

      if (sectors && Object.keys(sectors).length > 0) {
        ops.push(
          prisma.investmentAssetSector.createMany({
            data: Object.entries(sectors).map(([sector, pct]) => ({ assetId, sector, pct })),
            skipDuplicates: true,
          }),
        );
      }

      if (Array.isArray(holdings) && holdings.length > 0) {
        ops.push(
          prisma.investmentAssetHolding.createMany({
            data: holdings.map((h, i) => ({
              assetId,
              name: h.name,
              ticker: h.ticker ?? null,
              weight: Number(h.weight ?? 0),
              sortOrder: i,
            })),
            skipDuplicates: true,
          }),
        );
      }

      if (ops.length > 0) {
        await prisma.$transaction(ops);
      }

      migrated++;
    } catch (e: any) {
      console.error(`Error migrating assetId=${assetId}: ${e?.message ?? e}`);
      errors++;
    }
  }

  console.log(`Done. Migrated: ${migrated} | Skipped (already had data): ${skipped} | Errors: ${errors}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
