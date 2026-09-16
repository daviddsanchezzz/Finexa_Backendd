/**
 * Clona toda la actividad financiera del usuario SOURCE_EMAIL en un usuario
 * nuevo TARGET_EMAIL, para tener una cuenta de pruebas con datos realistas.
 *
 * Se excluye deliberadamente (no se clona):
 * - Friendship, WalletShare, TripMember: apuntan a OTROS usuarios reales; no
 *   tiene sentido ni es correcto vincular al usuario de pruebas con ellos.
 * - refreshToken, quickAddToken, DeviceToken: específicos de sesión/dispositivo,
 *   se regeneran solos al iniciar sesión desde la app.
 * - UserDocument, TripDocument, MonthlyReport: registros centrados en un
 *   archivo adjunto (identidad/seguros/informe); no se duplican.
 *
 * El password se copia tal cual (ya viene hasheado con bcrypt, autocontenido
 * — el hash no depende del email), así que la cuenta nueva se abre con la
 * MISMA contraseña que la cuenta original.
 *
 * Run:
 *   npx ts-node -r tsconfig-paths/register prisma/clone-user.ts
 *
 * Si el script falla a mitad de camino, usa prisma/clone-user-cleanup.ts
 * para borrar todo lo creado bajo TARGET_EMAIL y poder relanzar limpio.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const SOURCE_EMAIL = 'davidsr1919@gmail.com';
const TARGET_EMAIL = 'davidsr4444@gmail.com';

// ── utilidades ──────────────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function createManyChunked<T>(label: string, items: T[], fn: (batch: T[]) => Promise<unknown>) {
  if (items.length === 0) {
    console.log(`  ${label}: 0`);
    return;
  }
  for (const batch of chunk(items, 200)) {
    await fn(batch);
  }
  console.log(`  ${label}: ${items.length}`);
}

// Concurrencia limitada para las creates secuenciales donde necesitamos el
// id nuevo de cada fila (no podemos usar createMany porque otras tablas
// referencian estos ids después).
async function pMap<T, R>(items: T[], mapper: (item: T) => Promise<R>, concurrency = 8): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await mapper(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

const remap = (map: Map<number, number>, id: number | null | undefined) =>
  id == null ? id : map.get(id) ?? null;

async function main() {
  const source = await prisma.user.findUnique({ where: { email: SOURCE_EMAIL } });
  if (!source) throw new Error(`No existe el usuario origen ${SOURCE_EMAIL}`);

  const existingTarget = await prisma.user.findUnique({ where: { email: TARGET_EMAIL } });
  if (existingTarget) {
    throw new Error(
      `Ya existe un usuario ${TARGET_EMAIL} (id=${existingTarget.id}). Bórralo con prisma/clone-user-cleanup.ts antes de relanzar.`,
    );
  }

  console.log(`Clonando user id=${source.id} (${source.email}) -> ${TARGET_EMAIL}...`);

  const newUser = await prisma.user.create({
    data: {
      name: source.name,
      email: TARGET_EMAIL,
      password: source.password, // hash bcrypt autocontenido: misma contraseña que el original
      language: source.language,
      currency: source.currency,
      theme: source.theme,
      pinnedFinanceTabModuleKey: source.pinnedFinanceTabModuleKey,
      active: true,
    },
  });
  console.log(`Nuevo usuario id=${newUser.id}`);

  const walletMap = new Map<number, number>();
  const categoryMap = new Map<number, number>();
  const subcategoryMap = new Map<number, number>();
  const tripMap = new Map<number, number>();
  const projectMap = new Map<number, number>();
  const assetMap = new Map<number, number>();
  const txMap = new Map<number, number>();
  const budgetMap = new Map<number, number>();
  const distributionMap = new Map<number, number>();
  const planItemMap = new Map<number, number>();

  // ── Wallets ──────────────────────────────────────────────────────────
  const wallets = await prisma.wallet.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(wallets, async (w) => {
    const created = await prisma.wallet.create({
      data: {
        name: w.name,
        description: w.description,
        emoji: w.emoji,
        balance: w.balance,
        currency: w.currency,
        kind: w.kind,
        position: w.position,
        userId: newUser.id,
        createdBy: w.createdBy != null ? newUser.id : null,
        active: w.active,
      },
    });
    walletMap.set(w.id, created.id);
  });
  console.log(`Wallets: ${wallets.length}`);

  // ── Categories ───────────────────────────────────────────────────────
  const categories = await prisma.category.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(categories, async (c) => {
    const created = await prisma.category.create({
      data: {
        name: c.name,
        type: c.type,
        emoji: c.emoji,
        color: c.color,
        kind: c.kind,
        position: c.position,
        userId: newUser.id,
        createdBy: c.createdBy != null ? newUser.id : null,
        active: c.active,
      },
    });
    categoryMap.set(c.id, created.id);
  });
  console.log(`Categories: ${categories.length}`);

  // ── Trips ────────────────────────────────────────────────────────────
  const trips = await prisma.trip.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(trips, async (t) => {
    const created = await prisma.trip.create({
      data: {
        userId: newUser.id,
        name: t.name,
        destination: t.destination,
        startDate: t.startDate,
        endDate: t.endDate,
        companions: t.companions,
        status: t.status,
        statusManuallySet: t.statusManuallySet,
        cost: t.cost,
        budget: t.budget,
        continent: t.continent,
        year: t.year,
        coverImageUrl: t.coverImageUrl,
      },
    });
    tripMap.set(t.id, created.id);
  });
  console.log(`Trips: ${trips.length}`);

  // ── Projects ─────────────────────────────────────────────────────────
  const projects = await prisma.project.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(projects, async (p) => {
    const created = await prisma.project.create({
      data: {
        userId: newUser.id,
        name: p.name,
        description: p.description,
        type: p.type,
        status: p.status,
        startDate: p.startDate,
        endDate: p.endDate,
        notes: p.notes,
      },
    });
    projectMap.set(p.id, created.id);
  });
  console.log(`Projects: ${projects.length}`);

  // ── Investment assets ────────────────────────────────────────────────
  const assets = await prisma.investmentAsset.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(assets, async (a) => {
    const created = await prisma.investmentAsset.create({
      data: {
        userId: newUser.id,
        name: a.name,
        abbreviation: a.abbreviation,
        description: a.description,
        type: a.type,
        riskType: a.riskType,
        currency: a.currency,
        quantity: a.quantity,
        identificator: a.identificator,
        provider: a.provider,
        metadataUrl: a.metadataUrl,
        initialInvested: a.initialInvested,
        active: a.active,
        archived: a.archived,
      },
    });
    assetMap.set(a.id, created.id);
  });
  console.log(`InvestmentAssets: ${assets.length}`);

  // ── Subcategories (bajo mis propias categorías, incluye las de viaje) ──
  const subcategories = await prisma.subcategory.findMany({
    where: { categoryId: { in: categories.map((c) => c.id) } },
    orderBy: { id: 'asc' },
  });
  await pMap(subcategories, async (s) => {
    const created = await prisma.subcategory.create({
      data: {
        name: s.name,
        emoji: s.emoji,
        color: s.color,
        position: s.position,
        categoryId: categoryMap.get(s.categoryId)!,
        tripId: s.tripId != null ? tripMap.get(s.tripId) ?? null : null,
        createdBy: s.createdBy != null ? newUser.id : null,
        active: s.active,
      },
    });
    subcategoryMap.set(s.id, created.id);
  });
  console.log(`Subcategories: ${subcategories.length}`);

  // ── Transactions (2 pasadas: crear, luego remapear parentId recurrente) ─
  const transactions = await prisma.transaction.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(transactions, async (tr) => {
    const created = await prisma.transaction.create({
      data: {
        type: tr.type,
        amount: tr.amount,
        description: tr.description,
        date: tr.date,
        isRecurring: tr.isRecurring,
        recurrence: tr.recurrence,
        categoryId: remap(categoryMap, tr.categoryId),
        subcategoryId: remap(subcategoryMap, tr.subcategoryId),
        fromWalletId: remap(walletMap, tr.fromWalletId),
        toWalletId: remap(walletMap, tr.toWalletId),
        walletId: remap(walletMap, tr.walletId),
        userId: newUser.id,
        tripId: remap(tripMap, tr.tripId),
        projectId: remap(projectMap, tr.projectId),
        investmentAssetId: remap(assetMap, tr.investmentAssetId),
        source: tr.source,
        excludeFromStats: tr.excludeFromStats,
        createdBy: tr.createdBy != null ? newUser.id : null,
        active: tr.active,
        createdAt: tr.createdAt,
        updatedAt: tr.updatedAt,
      },
    });
    txMap.set(tr.id, created.id);
  }, 15);
  console.log(`Transactions: ${transactions.length}`);

  const recurringChildren = transactions.filter((tr) => tr.parentId != null);
  await pMap(recurringChildren, async (tr) => {
    const newParentId = txMap.get(tr.parentId!);
    if (!newParentId) return;
    await prisma.transaction.update({ where: { id: txMap.get(tr.id)! }, data: { parentId: newParentId } });
  }, 15);
  console.log(`  -> parentId remapeado en ${recurringChildren.length} transacciones recurrentes`);

  // ── Debts ────────────────────────────────────────────────────────────
  const debts = await prisma.debt.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await createManyChunked('Debts', debts, (batch) =>
    prisma.debt.createMany({
      data: batch.map((d) => ({
        userId: newUser.id,
        type: d.type,
        direction: d.direction,
        status: d.status,
        name: d.name,
        entity: d.entity,
        emoji: d.emoji,
        color: d.color,
        totalAmount: d.totalAmount,
        payed: d.payed,
        remainingAmount: d.remainingAmount,
        interestRate: d.interestRate,
        monthlyPayment: d.monthlyPayment,
        startDate: d.startDate,
        nextDueDate: d.nextDueDate,
        installmentsPaid: d.installmentsPaid,
        subcategoryId: remap(subcategoryMap, d.subcategoryId),
        expenseSubcategoryId: remap(subcategoryMap, d.expenseSubcategoryId),
        incomeSubcategoryId: remap(subcategoryMap, d.incomeSubcategoryId),
        createdBy: d.createdBy != null ? newUser.id : null,
        active: d.active,
      })),
    }),
  );

  // ── Budgets + límites por categoría ─────────────────────────────────
  const budgets = await prisma.budget.findMany({ where: { userId: source.id }, orderBy: { id: 'asc' } });
  await pMap(budgets, async (b) => {
    const created = await prisma.budget.create({
      data: {
        name: b.name,
        period: b.period,
        startDate: b.startDate,
        totalLimit: b.totalLimit,
        walletIds: b.walletIds.map((id) => walletMap.get(id)!).filter(Boolean),
        autoRenew: b.autoRenew,
        carryOverRemaining: b.carryOverRemaining,
        userId: newUser.id,
        active: b.active,
        createdBy: b.createdBy != null ? newUser.id : null,
        limit: b.limit,
        categoryId: remap(categoryMap, b.categoryId),
        walletId: remap(walletMap, b.walletId),
      },
    });
    budgetMap.set(b.id, created.id);
  });
  console.log(`Budgets: ${budgets.length}`);

  const budgetCategoryLimits = await prisma.budgetCategoryLimit.findMany({
    where: { budgetId: { in: budgets.map((b) => b.id) } },
  });
  await createManyChunked('BudgetCategoryLimit', budgetCategoryLimits, (batch) =>
    prisma.budgetCategoryLimit.createMany({
      data: batch.map((l) => ({
        budgetId: budgetMap.get(l.budgetId)!,
        categoryId: categoryMap.get(l.categoryId)!,
        limit: l.limit,
      })),
    }),
  );

  // ── Project sub-entidades ───────────────────────────────────────────
  const partners = await prisma.projectPartner.findMany({ where: { projectId: { in: projects.map((p) => p.id) } } });
  await createManyChunked('ProjectPartner', partners, (batch) =>
    prisma.projectPartner.createMany({
      data: batch.map((x) => ({ projectId: projectMap.get(x.projectId)!, name: x.name, percentage: x.percentage, isMe: x.isMe })),
    }),
  );

  const manualEntries = await prisma.projectManualEntry.findMany({ where: { projectId: { in: projects.map((p) => p.id) } } });
  await createManyChunked('ProjectManualEntry', manualEntries, (batch) =>
    prisma.projectManualEntry.createMany({
      data: batch.map((x) => ({
        projectId: projectMap.get(x.projectId)!,
        type: x.type,
        title: x.title,
        description: x.description,
        amount: x.amount,
        date: x.date,
        category: x.category,
        notes: x.notes,
        entryKind: x.entryKind,
        partnerName: x.partnerName,
      })),
    }),
  );

  const distributions = await prisma.projectProfitDistribution.findMany({ where: { projectId: { in: projects.map((p) => p.id) } }, orderBy: { id: 'asc' } });
  await pMap(distributions, async (d) => {
    const created = await prisma.projectProfitDistribution.create({
      data: { projectId: projectMap.get(d.projectId)!, title: d.title, totalAmount: d.totalAmount, date: d.date, notes: d.notes },
    });
    distributionMap.set(d.id, created.id);
  });
  console.log(`ProjectProfitDistribution: ${distributions.length}`);

  const distributionLines = await prisma.projectProfitDistributionLine.findMany({ where: { distributionId: { in: distributions.map((d) => d.id) } } });
  await createManyChunked('ProjectProfitDistributionLine', distributionLines, (batch) =>
    prisma.projectProfitDistributionLine.createMany({
      data: batch.map((x) => ({
        distributionId: distributionMap.get(x.distributionId)!,
        partnerName: x.partnerName,
        amount: x.amount,
        percentage: x.percentage,
        notes: x.notes,
      })),
    }),
  );

  // ── Trip sub-entidades (excepto TripDocument) ───────────────────────
  const tripIds = trips.map((t) => t.id);

  const notes = await prisma.tripNote.findMany({ where: { tripId: { in: tripIds } } });
  await createManyChunked('TripNote', notes, (batch) =>
    prisma.tripNote.createMany({ data: batch.map((x) => ({ tripId: tripMap.get(x.tripId)!, title: x.title, body: x.body, pinned: x.pinned })) }),
  );

  const tasks = await prisma.tripTask.findMany({ where: { tripId: { in: tripIds } } });
  await createManyChunked('TripTask', tasks, (batch) =>
    prisma.tripTask.createMany({ data: batch.map((x) => ({ tripId: tripMap.get(x.tripId)!, title: x.title, status: x.status, priority: x.priority, dueDate: x.dueDate })) }),
  );

  const contacts = await prisma.tripContact.findMany({ where: { tripId: { in: tripIds } } });
  await createManyChunked('TripContact', contacts, (batch) =>
    prisma.tripContact.createMany({ data: batch.map((x) => ({ tripId: tripMap.get(x.tripId)!, name: x.name, phone: x.phone, notes: x.notes })) }),
  );

  const countryStays = await prisma.tripCountryStay.findMany({ where: { tripId: { in: tripIds } } });
  await createManyChunked('TripCountryStay', countryStays, (batch) =>
    prisma.tripCountryStay.createMany({
      data: batch.map((x) => ({ tripId: tripMap.get(x.tripId)!, country: x.country, continent: x.continent, startDate: x.startDate, endDate: x.endDate, order: x.order })),
    }),
  );

  const checklistItems = await prisma.tripChecklistItem.findMany({ where: { tripId: { in: tripIds } } });
  await createManyChunked('TripChecklistItem', checklistItems, (batch) =>
    prisma.tripChecklistItem.createMany({
      data: batch.map((x) => ({ tripId: tripMap.get(x.tripId)!, userId: newUser.id, category: x.category, label: x.label, checked: x.checked, order: x.order })),
    }),
  );

  const galleryPhotos = await prisma.tripGalleryPhoto.findMany({ where: { tripId: { in: tripIds } } });
  await createManyChunked('TripGalleryPhoto', galleryPhotos, (batch) =>
    prisma.tripGalleryPhoto.createMany({
      data: batch.map((x) => ({ tripId: tripMap.get(x.tripId)!, url: x.url, fileName: x.fileName, mimeType: x.mimeType, dayDate: x.dayDate })),
    }),
  );

  // ── TripPlanItem + detalles 1-1 + adjuntos ──────────────────────────
  const planItems = await prisma.tripPlanItem.findMany({ where: { tripId: { in: tripIds } }, orderBy: { id: 'asc' } });
  await pMap(planItems, async (pi) => {
    const created = await prisma.tripPlanItem.create({
      data: {
        tripId: tripMap.get(pi.tripId)!,
        type: pi.type,
        title: pi.title,
        date: pi.date,
        startTime: pi.startTime,
        endTime: pi.endTime,
        day: pi.day,
        startAt: pi.startAt,
        endAt: pi.endAt,
        timezone: pi.timezone,
        location: pi.location,
        notes: pi.notes,
        cost: pi.cost as Prisma.Decimal | null,
        payed: pi.payed,
        currency: pi.currency,
        logistics: pi.logistics,
        isReservation: pi.isReservation,
        paymentStatus: pi.paymentStatus,
        metadata: pi.metadata as Prisma.InputJsonValue | undefined,
        transactionId: remap(txMap, pi.transactionId),
        departureReminderSentAt: pi.departureReminderSentAt,
        checkInReminderSentAt: pi.checkInReminderSentAt,
        checkOutReminderSentAt: pi.checkOutReminderSentAt,
      },
    });
    planItemMap.set(pi.id, created.id);
  }, 15);
  console.log(`TripPlanItem: ${planItems.length}`);

  const planItemIds = planItems.map((p) => p.id);

  const flights = await prisma.flightDetails.findMany({ where: { planItemId: { in: planItemIds } } });
  await createManyChunked('FlightDetails', flights, (batch) =>
    prisma.flightDetails.createMany({
      data: batch.map((x) => ({
        planItemId: planItemMap.get(x.planItemId)!,
        provider: x.provider,
        status: x.status,
        lastUpdatedUtc: x.lastUpdatedUtc,
        flightNumberRaw: x.flightNumberRaw,
        flightNumberIata: x.flightNumberIata,
        airlineName: x.airlineName,
        airlineIata: x.airlineIata,
        fromIata: x.fromIata,
        toIata: x.toIata,
        fromName: x.fromName,
        toName: x.toName,
        fromCity: x.fromCity,
        toCity: x.toCity,
        depTz: x.depTz,
        arrTz: x.arrTz,
        depTerminal: x.depTerminal,
        arrTerminal: x.arrTerminal,
        gate: x.gate,
        seat: x.seat,
        bookingRef: x.bookingRef,
        aircraftModel: x.aircraftModel,
        schedDepAt: x.schedDepAt,
        schedArrAt: x.schedArrAt,
        estDepAt: x.estDepAt,
        estArrAt: x.estArrAt,
        actDepAt: x.actDepAt,
        actArrAt: x.actArrAt,
        providerRaw: x.providerRaw as Prisma.InputJsonValue | undefined,
      })),
    }),
  );

  const accommodations = await prisma.accommodationDetails.findMany({ where: { planItemId: { in: planItemIds } } });
  await createManyChunked('AccommodationDetails', accommodations, (batch) =>
    prisma.accommodationDetails.createMany({
      data: batch.map((x) => ({
        planItemId: planItemMap.get(x.planItemId)!,
        name: x.name,
        address: x.address,
        city: x.city,
        country: x.country,
        checkInAt: x.checkInAt,
        checkOutAt: x.checkOutAt,
        guests: x.guests,
        rooms: x.rooms,
        roomType: x.roomType,
        bathroomType: x.bathroomType,
        bookingRef: x.bookingRef,
        phone: x.phone,
        website: x.website,
        coverImageUrl: x.coverImageUrl,
        metadata: x.metadata as Prisma.InputJsonValue | undefined,
      })),
    }),
  );

  const destTransport = await prisma.destinationTransportDetails.findMany({ where: { planItemId: { in: planItemIds } } });
  await createManyChunked('DestinationTransportDetails', destTransport, (batch) =>
    prisma.destinationTransportDetails.createMany({
      data: batch.map((x) => ({
        planItemId: planItemMap.get(x.planItemId)!,
        mode: x.mode,
        company: x.company,
        bookingRef: x.bookingRef,
        fromName: x.fromName,
        toName: x.toName,
        depAt: x.depAt,
        arrAt: x.arrAt,
        metadata: x.metadata as Prisma.InputJsonValue | undefined,
      })),
    }),
  );

  const expenseDetails = await prisma.expenseDetails.findMany({ where: { planItemId: { in: planItemIds } } });
  await createManyChunked('ExpenseDetails', expenseDetails, (batch) =>
    prisma.expenseDetails.createMany({ data: batch.map((x) => ({ planItemId: planItemMap.get(x.planItemId)!, category: x.category })) }),
  );

  const attachments = await prisma.attachment.findMany({ where: { planItemId: { in: planItemIds } } });
  await createManyChunked('Attachment', attachments, (batch) =>
    prisma.attachment.createMany({
      data: batch.map((x) => ({
        planItemId: x.planItemId != null ? planItemMap.get(x.planItemId)! : null,
        kind: x.kind,
        url: x.url,
        filename: x.filename,
        mimeType: x.mimeType,
        sizeBytes: x.sizeBytes,
        metadata: x.metadata as Prisma.InputJsonValue | undefined,
      })),
    }),
  );

  // ── Investment sub-entidades ─────────────────────────────────────────
  const assetIds = assets.map((a) => a.id);

  const regions = await prisma.investmentAssetRegion.findMany({ where: { assetId: { in: assetIds } } });
  await createManyChunked('InvestmentAssetRegion', regions, (batch) =>
    prisma.investmentAssetRegion.createMany({ data: batch.map((x) => ({ assetId: assetMap.get(x.assetId)!, country: x.country, pct: x.pct })) }),
  );

  const sectors = await prisma.investmentAssetSector.findMany({ where: { assetId: { in: assetIds } } });
  await createManyChunked('InvestmentAssetSector', sectors, (batch) =>
    prisma.investmentAssetSector.createMany({ data: batch.map((x) => ({ assetId: assetMap.get(x.assetId)!, sector: x.sector, pct: x.pct })) }),
  );

  const holdings = await prisma.investmentAssetHolding.findMany({ where: { assetId: { in: assetIds } } });
  await createManyChunked('InvestmentAssetHolding', holdings, (batch) =>
    prisma.investmentAssetHolding.createMany({
      data: batch.map((x) => ({ assetId: assetMap.get(x.assetId)!, name: x.name, ticker: x.ticker, weight: x.weight, sortOrder: x.sortOrder })),
    }),
  );

  const assetMetas = await prisma.assetMetadata.findMany({ where: { assetId: { in: assetIds } } });
  await createManyChunked('AssetMetadata', assetMetas, (batch) =>
    prisma.assetMetadata.createMany({
      data: batch.map((x) => ({
        assetId: assetMap.get(x.assetId)!,
        isin: x.isin,
        fmpSymbol: x.fmpSymbol,
        symbol: x.symbol,
        provider: x.provider,
        currency: x.currency,
        countriesJson: x.countriesJson as Prisma.InputJsonValue | undefined,
        sectorsJson: x.sectorsJson as Prisma.InputJsonValue | undefined,
        topHoldingsJson: x.topHoldingsJson as Prisma.InputJsonValue | undefined,
        cryptoCategory: x.cryptoCategory,
        source: x.source,
        sourceUrl: x.sourceUrl,
        asOfDate: x.asOfDate,
        lastError: x.lastError,
        syncedAt: x.syncedAt,
      })),
    }),
  );

  const valuations = await prisma.investmentValuationSnapshot.findMany({ where: { userId: source.id } });
  await createManyChunked('InvestmentValuationSnapshot', valuations, (batch) =>
    prisma.investmentValuationSnapshot.createMany({
      data: batch.map((x) => ({
        userId: newUser.id,
        assetId: assetMap.get(x.assetId)!,
        date: x.date,
        value: x.value,
        currency: x.currency,
        unitPrice: x.unitPrice,
        quantity: x.quantity,
        source: x.source,
        active: x.active,
      })),
    }),
  );

  const operations = await prisma.investmentOperation.findMany({ where: { userId: source.id } });
  await createManyChunked('InvestmentOperation', operations, (batch) =>
    prisma.investmentOperation.createMany({
      data: batch.map((x) => ({
        userId: newUser.id,
        assetId: assetMap.get(x.assetId)!,
        type: x.type,
        date: x.date,
        amount: x.amount,
        quantity: x.quantity,
        fee: x.fee,
        transactionId: remap(txMap, x.transactionId),
        swapGroupId: x.swapGroupId,
        active: x.active,
      })),
    }),
  );

  const targetAllocations = await prisma.investmentTargetAllocation.findMany({ where: { userId: source.id } });
  await createManyChunked('InvestmentTargetAllocation', targetAllocations, (batch) =>
    prisma.investmentTargetAllocation.createMany({
      data: batch.map((x) => ({ userId: newUser.id, assetId: assetMap.get(x.assetId)!, targetPct: x.targetPct, active: x.active })),
    }),
  );

  const portfolioSnapshots = await prisma.portfolioSnapshot.findMany({ where: { userId: source.id } });
  await createManyChunked('PortfolioSnapshot', portfolioSnapshots, (batch) =>
    prisma.portfolioSnapshot.createMany({
      data: batch.map((x) => ({
        userId: newUser.id,
        monthStart: x.monthStart,
        currency: x.currency,
        startValue: x.startValue,
        endValue: x.endValue,
        cashflowNet: x.cashflowNet,
        profit: x.profit,
        returnPct: x.returnPct,
        isAuto: x.isAuto,
        active: x.active,
      })),
    }),
  );

  // ── Resto de datos del usuario ──────────────────────────────────────
  const manualMonths = await prisma.manualMonthData.findMany({ where: { userId: source.id } });
  await createManyChunked('ManualMonthData', manualMonths, (batch) =>
    prisma.manualMonthData.createMany({
      data: batch.map((x) => ({
        userId: newUser.id,
        year: x.year,
        month: x.month,
        income: x.income,
        expense: x.expense,
        finalBalance: x.finalBalance,
        createdBy: x.createdBy != null ? newUser.id : null,
        active: x.active,
      })),
    }),
  );

  const notifications = await prisma.notification.findMany({ where: { userId: source.id } });
  await createManyChunked('Notification', notifications, (batch) =>
    prisma.notification.createMany({
      data: batch.map((x) => ({
        title: x.title,
        message: x.message,
        type: x.type,
        data: x.data as Prisma.InputJsonValue | undefined,
        read: x.read,
        userId: newUser.id,
        createdBy: x.createdBy != null ? newUser.id : null,
        active: x.active,
      })),
    }),
  );

  const notifPref = await prisma.notificationPreference.findUnique({ where: { userId: source.id } });
  if (notifPref) {
    await prisma.notificationPreference.create({
      data: {
        userId: newUser.id,
        recurringTransactions: notifPref.recurringTransactions,
        budgetThresholdAlerts: notifPref.budgetThresholdAlerts,
      },
    });
  }
  console.log(`NotificationPreference: ${notifPref ? 1 : 0}`);

  const wonderVisits = await prisma.wonderVisit.findMany({ where: { userId: source.id } });
  await createManyChunked('WonderVisit', wonderVisits, (batch) =>
    prisma.wonderVisit.createMany({
      data: batch.map((x) => ({
        userId: newUser.id,
        wonderKey: x.wonderKey,
        visitedAt: x.visitedAt,
        photoUrl: x.photoUrl,
        photoOffset: x.photoOffset,
        photoOffsetX: x.photoOffsetX,
        tripId: remap(tripMap, x.tripId),
      })),
    }),
  );

  const allocationPlan = await prisma.allocationPlan.findUnique({ where: { userId: source.id }, include: { items: true } });
  if (allocationPlan) {
    const createdPlan = await prisma.allocationPlan.create({
      data: { userId: newUser.id, income: allocationPlan.income, currency: allocationPlan.currency },
    });
    await createManyChunked('AllocationItem', allocationPlan.items, (batch) =>
      prisma.allocationItem.createMany({
        data: batch.map((x) => ({ planId: createdPlan.id, category: x.category, name: x.name, amount: x.amount, order: x.order })),
      }),
    );
  }
  console.log(`AllocationPlan: ${allocationPlan ? 1 : 0}`);

  console.log('\n✅ Clonación completa.');
  console.log(`   Usuario nuevo: id=${newUser.id}, email=${TARGET_EMAIL}`);
  console.log(`   Contraseña: la misma que la de ${SOURCE_EMAIL}`);
}

main()
  .catch((e) => {
    console.error('\n❌ Error durante la clonación:', e);
    console.error('   Si quedaron datos a medias, corre prisma/clone-user-cleanup.ts para limpiar antes de reintentar.');
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
