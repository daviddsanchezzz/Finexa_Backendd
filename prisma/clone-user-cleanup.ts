/**
 * Borra por completo al usuario TARGET_EMAIL y todo lo que le pertenece.
 * Contrapartida de prisma/clone-user.ts: úsalo si ese script falló a
 * mitad de camino y quieres limpiar antes de relanzarlo, o si simplemente
 * quieres eliminar la cuenta de pruebas.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register prisma/clone-user-cleanup.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_EMAIL = 'davidsr4444@gmail.com';

async function main() {
  const target = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (!target) {
    console.log(`No existe ningún usuario ${TARGET_EMAIL}. Nada que borrar.`);
    return;
  }
  const userId = target.id;
  console.log(`Borrando usuario id=${userId} (${TARGET_EMAIL}) y todos sus datos...`);

  const walletIds = (await prisma.wallet.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);
  const categoryIds = (await prisma.category.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);
  const tripIds = (await prisma.trip.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);
  const projectIds = (await prisma.project.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);
  const assetIds = (await prisma.investmentAsset.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);
  const budgetIds = (await prisma.budget.findMany({ where: { userId }, select: { id: true } })).map((x) => x.id);
  const planItemIds = (await prisma.tripPlanItem.findMany({ where: { tripId: { in: tripIds } }, select: { id: true } })).map((x) => x.id);

  const del = async (label: string, fn: () => Promise<{ count: number }>) => {
    const { count } = await fn();
    console.log(`  ${label}: ${count}`);
  };

  await del('AllocationItem', () => prisma.allocationItem.deleteMany({ where: { plan: { userId } } }));
  await del('AllocationPlan', () => prisma.allocationPlan.deleteMany({ where: { userId } }));
  await del('WonderVisit', () => prisma.wonderVisit.deleteMany({ where: { userId } }));
  await del('NotificationPreference', () => prisma.notificationPreference.deleteMany({ where: { userId } }));
  await del('Notification', () => prisma.notification.deleteMany({ where: { userId } }));
  await del('ManualMonthData', () => prisma.manualMonthData.deleteMany({ where: { userId } }));
  await del('PortfolioSnapshot', () => prisma.portfolioSnapshot.deleteMany({ where: { userId } }));
  await del('InvestmentTargetAllocation', () => prisma.investmentTargetAllocation.deleteMany({ where: { userId } }));
  await del('InvestmentOperation', () => prisma.investmentOperation.deleteMany({ where: { userId } }));
  await del('InvestmentValuationSnapshot', () => prisma.investmentValuationSnapshot.deleteMany({ where: { userId } }));
  await del('AssetMetadata', () => prisma.assetMetadata.deleteMany({ where: { assetId: { in: assetIds } } }));
  await del('InvestmentAssetHolding', () => prisma.investmentAssetHolding.deleteMany({ where: { assetId: { in: assetIds } } }));
  await del('InvestmentAssetSector', () => prisma.investmentAssetSector.deleteMany({ where: { assetId: { in: assetIds } } }));
  await del('InvestmentAssetRegion', () => prisma.investmentAssetRegion.deleteMany({ where: { assetId: { in: assetIds } } }));

  await del('Attachment', () => prisma.attachment.deleteMany({ where: { planItemId: { in: planItemIds } } }));
  await del('ExpenseDetails', () => prisma.expenseDetails.deleteMany({ where: { planItemId: { in: planItemIds } } }));
  await del('DestinationTransportDetails', () => prisma.destinationTransportDetails.deleteMany({ where: { planItemId: { in: planItemIds } } }));
  await del('AccommodationDetails', () => prisma.accommodationDetails.deleteMany({ where: { planItemId: { in: planItemIds } } }));
  await del('FlightDetails', () => prisma.flightDetails.deleteMany({ where: { planItemId: { in: planItemIds } } }));
  await del('TripPlanItem', () => prisma.tripPlanItem.deleteMany({ where: { tripId: { in: tripIds } } }));

  await del('TripGalleryPhoto', () => prisma.tripGalleryPhoto.deleteMany({ where: { tripId: { in: tripIds } } }));
  await del('TripChecklistItem', () => prisma.tripChecklistItem.deleteMany({ where: { tripId: { in: tripIds } } }));
  await del('TripCountryStay', () => prisma.tripCountryStay.deleteMany({ where: { tripId: { in: tripIds } } }));
  await del('TripContact', () => prisma.tripContact.deleteMany({ where: { tripId: { in: tripIds } } }));
  await del('TripTask', () => prisma.tripTask.deleteMany({ where: { tripId: { in: tripIds } } }));
  await del('TripNote', () => prisma.tripNote.deleteMany({ where: { tripId: { in: tripIds } } }));

  await del('ProjectManualEntry', () => prisma.projectManualEntry.deleteMany({ where: { projectId: { in: projectIds } } }));
  await del('ProjectPartner', () => prisma.projectPartner.deleteMany({ where: { projectId: { in: projectIds } } }));

  await del('BudgetCategoryLimit', () => prisma.budgetCategoryLimit.deleteMany({ where: { budgetId: { in: budgetIds } } }));
  await del('Budget', () => prisma.budget.deleteMany({ where: { userId } }));
  await del('Debt', () => prisma.debt.deleteMany({ where: { userId } }));
  await del('Transaction', () => prisma.transaction.deleteMany({ where: { userId } }));

  await del('Subcategory', () => prisma.subcategory.deleteMany({ where: { categoryId: { in: categoryIds } } }));
  await del('Trip', () => prisma.trip.deleteMany({ where: { userId } }));
  await del('InvestmentAsset', () => prisma.investmentAsset.deleteMany({ where: { userId } }));
  await del('Project', () => prisma.project.deleteMany({ where: { userId } }));
  await del('Category', () => prisma.category.deleteMany({ where: { userId } }));
  await del('Wallet', () => prisma.wallet.deleteMany({ where: { userId } }));

  await prisma.user.delete({ where: { id: userId } });
  console.log(`\n✅ Usuario ${TARGET_EMAIL} y todos sus datos eliminados.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
