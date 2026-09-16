/**
 * Data migration: adapta los Budget existentes (modelo antiguo: 1 presupuesto =
 * 1 importe + 0/1 categoría, campos `limit`/`categoryId`/`walletId`) al nuevo
 * modelo multi-categoría (`totalLimit` opcional + `categoryLimits[]` + `walletIds[]`).
 *
 * Semántica preservada:
 * - Budget antiguo SIN categoryId (presupuesto general) -> totalLimit = limit,
 *   sin categoryLimits (equivalente al CASO A: solo límite global).
 * - Budget antiguo CON categoryId (presupuesto por categoría) -> totalLimit
 *   queda sin definir y se crea un único categoryLimit {categoryId, limit}
 *   (equivalente al CASO C: solo límites por categoría, sin límite global),
 *   que es exactamente lo que ese presupuesto controlaba antes.
 * - walletId antiguo (si existía) -> walletIds = [walletId]; si no, walletIds = [].
 *
 * Los campos legacy (`limit`, `categoryId`, `walletId`) NO se borran ni se
 * modifican: se conservan tal cual para no perder información histórica.
 *
 * Run once después de `npx prisma db push`:
 *   npx ts-node -r tsconfig-paths/register prisma/migrate-budgets-multi-category.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const budgets = await prisma.budget.findMany({
    select: {
      id: true,
      limit: true,
      categoryId: true,
      walletId: true,
      totalLimit: true,
      walletIds: true,
      categoryLimits: { select: { id: true } },
    },
  });

  console.log(`Found ${budgets.length} Budget rows to check.`);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const b of budgets) {
    const alreadyMigrated =
      b.totalLimit != null || b.categoryLimits.length > 0 || (b.walletIds?.length ?? 0) > 0;

    if (alreadyMigrated) {
      skipped++;
      continue;
    }

    if (b.limit == null) {
      // Nada que migrar (no debería ocurrir, pero por seguridad no tocamos nada).
      skipped++;
      continue;
    }

    try {
      const walletIds = b.walletId != null ? [b.walletId] : [];

      if (b.categoryId != null) {
        await prisma.$transaction([
          prisma.budgetCategoryLimit.upsert({
            where: { budgetId_categoryId: { budgetId: b.id, categoryId: b.categoryId } },
            create: { budgetId: b.id, categoryId: b.categoryId, limit: b.limit },
            update: {},
          }),
          prisma.budget.update({
            where: { id: b.id },
            data: { walletIds },
          }),
        ]);
      } else {
        await prisma.budget.update({
          where: { id: b.id },
          data: { totalLimit: b.limit, walletIds },
        });
      }

      migrated++;
    } catch (e: any) {
      console.error(`Error migrando budgetId=${b.id}: ${e?.message ?? e}`);
      errors++;
    }
  }

  console.log(`Done. Migrated: ${migrated} | Skipped (already migrated / nothing to do): ${skipped} | Errors: ${errors}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
