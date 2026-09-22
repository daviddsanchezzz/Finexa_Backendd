import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { PrismaDateTransformer } from 'src/common/prisma/prisma.transformer';
import { NotificationsService } from '../notifications/notifications.service';
import { BudgetsService } from '../budgets/budgets.service';
import { suggestCategoryFromHistory } from './category-suggestion';
import { CurrencyService } from '../currency/currency.service';

@Injectable()
export class TransactionsService {
  constructor(
    private prisma: PrismaService,
    private notifications: NotificationsService,
    private budgets: BudgetsService,
    private currency: CurrencyService,
  ) {}

  // ============================================================
  // HELPERS
  // ============================================================
  private async autoResolveTripId(userId: number, subcategoryId: number): Promise<number | undefined> {
    // Antes esto comparaba el nombre de la subcategoría con el nombre del
    // viaje (frágil: se rompía si renombrabas el viaje). Subcategory.tripId
    // es el enlace real y ya viene puesto por TripsService al crear la
    // subcategoría del viaje.
    const sub = await this.prisma.subcategory.findFirst({
      where: { id: subcategoryId },
      select: { tripId: true, trip: { select: { userId: true } } },
    });
    if (!sub?.tripId || sub.trip?.userId !== userId) return undefined;
    return sub.tripId;
  }

  // ============================================================
  // SUGERENCIA DE CATEGORÍA POR COMERCIO
  // ============================================================
  // Mira los gastos anteriores del usuario con esa misma descripción (p.ej.
  // "Mercadona", que llega desde el flujo de Wallet) y, si siempre tuvieron la
  // misma categoría/subcategoría, las devuelve para preseleccionarlas.
  async suggestCategory(userId: number, description: string) {
    const trimmed = (description ?? '').trim();
    if (!trimmed) return null;

    // `contains` insensitive es un prefiltro (superset); la comparación exacta
    // sin acentos ni mayúsculas la hace suggestCategoryFromHistory.
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        type: 'expense',
        active: true,
        isRecurring: false,
        categoryId: { not: null },
        description: { contains: trimmed, mode: 'insensitive' },
      },
      select: { description: true, categoryId: true, subcategoryId: true },
      orderBy: { date: 'desc' },
      take: 200,
    });

    return suggestCategoryFromHistory(trimmed, rows);
  }

  // ============================================================
  // CREATE
  // ============================================================
  async create(userId: number, dto: CreateTransactionDto) {
    const rawDate = dto.date ? new Date(dto.date) : new Date();

    if (isNaN(rawDate.getTime())) {
      throw new BadRequestException('Fecha inválida');
    }

    // Extraer info de recurrencia del DTO. `currency` se extrae aparte porque
    // se resuelve explícitamente más abajo (no siempre viene en el DTO).
    const { isRecurring, recurrence, parentId, tripExpenseCategory, quickAddId, currency: dtoCurrency, ...rest } = dto as any;

    // Auto-link to trip when subcategory belongs to a "Viajes" category
    // We capture tripId here but do NOT set it on the transaction —
    // instead we'll create a TripPlanItem so the expense integrates as a plan entry
    let autoTripIdForPlanItem: number | undefined;
    if (rest.subcategoryId && !rest.tripId) {
      autoTripIdForPlanItem = await this.autoResolveTripId(userId, rest.subcategoryId).catch(() => undefined);
    }

    // Moneda del movimiento: la que venga explícita en el DTO, si no la de la
    // cartera elegida, si no la moneda base del usuario. baseAmount/exchangeRate
    // se calculan UNA VEZ aquí, con el tipo histórico de `rawDate` — no se
    // recalculan después aunque cambie el tipo de cambio más adelante.
    const walletForCurrency = rest.walletId ?? rest.fromWalletId;
    const wallet = walletForCurrency
      ? await this.prisma.wallet.findUnique({ where: { id: walletForCurrency }, select: { currency: true } })
      : null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
    const baseCurrency = user?.currency ?? 'EUR';
    const txCurrency = dtoCurrency ?? wallet?.currency ?? baseCurrency;

    let baseAmount: number | null = null;
    let exchangeRate: number | null = null;
    if (txCurrency !== baseCurrency) {
      // Si CurrencyService no puede convertir (moneda inválida, provider
      // caído, sin tipo de cambio cacheado), la transacción se crea igual con
      // baseAmount/exchangeRate en null — como si fuera EUR=EUR. El dinero es
      // real y `amount`/`wallet.balance` no dependen de esto; bloquear el
      // registro de un gasto porque el servicio de divisas falló sería peor
      // que dejar esa consolidación pendiente para más adelante.
      try {
        const converted = await this.currency.convertToBase(userId, rest.amount, txCurrency, rawDate);
        baseAmount = converted.toNumber();
        exchangeRate = converted.dividedBy(rest.amount).toNumber();
      } catch {
        // Omitido a propósito: ver comentario de arriba.
      }
    }

    // 1) Crear SIEMPRE la transacción "real" (la que afecta al saldo)
    const transaction = await this.prisma.transaction.create({
      data: {
        ...rest,
        currency: txCurrency,
        baseAmount,
        exchangeRate,
        userId,
        date: rawDate,
        isRecurring: false,
        recurrence: null,
        parentId: parentId ?? null,
      },
    });

    // 2) Actualizar balances en función del tipo + validación inversión
    if (transaction.type === 'transfer') {
      const { fromWalletId, toWalletId, amount } = transaction;

      if (!fromWalletId || !toWalletId) {
        throw new BadRequestException('Transferencia inválida');
      }

      const toWallet = await this.prisma.wallet.findUnique({
        where: { id: toWalletId },
      });

      if (!toWallet) {
        throw new NotFoundException('Wallet destino no existe');
      }

      // ✅ si destino es wallet inversión, exige investmentAssetId
      if (toWallet.kind === 'investment' && !(transaction as any).investmentAssetId) {
        throw new BadRequestException(
          'investmentAssetId es obligatorio cuando el destino es una wallet de inversión',
        );
      }

      await this.prisma.wallet.update({
        where: { id: fromWalletId },
        data: { balance: { decrement: amount } },
      });

      await this.prisma.wallet.update({
        where: { id: toWalletId },
        data: { balance: { increment: amount } },
      });
    } else if (transaction.walletId) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { id: transaction.walletId },
      });

      if (!wallet) {
        throw new NotFoundException(
          `Wallet with ID ${transaction.walletId} not found`,
        );
      }

      const newBalance =
        transaction.type === 'income'
          ? wallet.balance + transaction.amount
          : wallet.balance - transaction.amount;

      await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balance: newBalance },
      });
    }

    // 2c) Si es un gasto, comprobar si con este importe algún presupuesto (o
    // sublímite de categoría) afectado llega al 85% o al 100% — no bloqueante,
    // no debe retrasar ni poder romper la creación de la transacción.
    if (transaction.type === 'expense') {
      this.budgets
        .checkBudgetThresholds({
          userId,
          walletId: transaction.walletId,
          categoryId: transaction.categoryId,
          date: transaction.date,
        })
        .catch(() => null);
    }

    // 2b) Si venimos del flujo "quick add" (link de Shortcuts), resolver la
    // notificación de "nuevo gasto" pendiente con ese mismo qid. Esperamos a
    // que termine (normalmente es instantáneo, la notificación ya existe)
    // para que cuando el frontend reciba la respuesta y refresque su lista
    // de notificaciones, el cambio ya esté aplicado en BD.
    if (quickAddId) {
      await this.notifications.resolveQuickTransaction(userId, quickAddId).catch(() => null);
    }

    // 3) Si hay auto-trip y NO es recurrente, crear TripPlanItem integrado.
    // Si el usuario ya eligió la categoría de viaje al crear la transacción,
    // queda clasificado directamente; si no, se crea "pendiente" para
    // clasificarlo luego desde la pestaña Gastos del viaje.
    if (autoTripIdForPlanItem != null && !isRecurring) {
      await this.prisma.tripPlanItem.create({
        data: {
          tripId: autoTripIdForPlanItem,
          type: 'expense',
          title: rest.description || 'Gasto',
          cost: rest.amount ?? null,
          date: rawDate,
          startTime: rawDate,
          transactionId: transaction.id,
          metadata: tripExpenseCategory
            ? { expenseCategory: tripExpenseCategory, autoCreatedFromTransaction: true }
            : { expenseCategory: 'other', pending: true, autoCreatedFromTransaction: true },
        },
      }).catch(() => null);
    }

    // 4) Si NO es recurrente, terminamos aquí
    if (!isRecurring || !recurrence) {
      return PrismaDateTransformer.toPlain(transaction);
    }

    // 4) Crear la PLANTILLA recurrente para futuras ejecuciones
    const nextDate = this.getNextDate(rawDate, recurrence);

    const template = await this.prisma.transaction.create({
      data: {
        type: transaction.type,
        amount: transaction.amount,
        description: transaction.description,
        date: nextDate, // fecha de la PRÓXIMA ejecución
        isRecurring: true,
        recurrence: recurrence, // "daily" | "weekly" | ...

        walletId: transaction.walletId,
        fromWalletId: transaction.fromWalletId,
        toWalletId: transaction.toWalletId,

        // ✅ CLAVE: copiar investmentAssetId para aportaciones recurrentes a inversión
        investmentAssetId: (transaction as any).investmentAssetId ?? null,

        categoryId: transaction.categoryId,
        subcategoryId: transaction.subcategoryId,
        tripId: transaction.tripId,
        projectId: (transaction as any).projectId ?? null,

        userId: transaction.userId,
        active: true,
        parentId: null, // la plantilla es raíz de la serie
      },
    });


    // 5) (Opcional pero recomendable) enlazar la primera ocurrencia con la plantilla
    // ✅ SOLO si la ocurrencia no venía ya enlazada (cron)
    if (!transaction.parentId) {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { parentId: template.id },
      });
    }

    // 6) Devolvemos la transacción real (la que ve el usuario)
    return PrismaDateTransformer.toPlain(transaction);
  }

  // ============================================================
  // FIND ALL
  // ============================================================
  async findAll(
    userId: number,
    filters?: {
      walletId?: number;
      walletIds?: number[];
      categoryId?: number;
      categoryIds?: number[];
      dateFrom?: string;
      dateTo?: string;
      type?: string;
      subcategoryId?: number;
      isRecurring?: boolean;
      investmentAssetId?: number;
      projectId?: number;
    },
  ) {
    try {
      const where: any = { userId, active: true };

      if (filters?.walletId && isNaN(Number(filters.walletId))) {
        throw new BadRequestException(
          'El parámetro walletId debe ser un número válido.',
        );
      }

      if (filters?.subcategoryId && isNaN(Number(filters.subcategoryId))) {
        throw new BadRequestException(
          'El parámetro subcategoryId debe ser un número válido.',
        );
      }

      if (
        filters?.type &&
        !['income', 'expense', 'transfer'].includes(filters.type)
      ) {
        throw new BadRequestException('El parámetro type no es válido.');
      }

      if (
        filters?.isRecurring !== undefined &&
        typeof filters.isRecurring !== 'boolean'
      ) {
        throw new BadRequestException(
          'El parámetro isRecurring debe ser un booleano.',
        );
      }

      if (filters?.dateFrom && isNaN(Date.parse(filters.dateFrom))) {
        throw new BadRequestException(
          'El parámetro dateFrom no tiene un formato de fecha válido.',
        );
      }

      if (filters?.dateTo && isNaN(Date.parse(filters.dateTo))) {
        throw new BadRequestException(
          'El parámetro dateTo no tiene un formato de fecha válido.',
        );
      }

      if (filters?.investmentAssetId && isNaN(Number(filters.investmentAssetId))) {
        throw new BadRequestException(
          'El parámetro investmentAssetId debe ser un número válido.',
        );
      }

      if (filters?.projectId && isNaN(Number(filters.projectId))) {
        throw new BadRequestException(
          'El parámetro projectId debe ser un número válido.',
        );
      }

      if (filters?.investmentAssetId) {
        where.investmentAssetId = filters.investmentAssetId;
      }

      if (filters?.projectId) {
        where.projectId = filters.projectId;
      }

      if (filters?.walletId) {
        where.walletId = filters.walletId;
      }

      if (filters?.walletIds && filters.walletIds.length > 0) {
        where.walletId = { in: filters.walletIds };
      }

      if (filters?.categoryId) {
        where.categoryId = filters.categoryId;
      }

      if (filters?.categoryIds && filters.categoryIds.length > 0) {
        where.categoryId = { in: filters.categoryIds };
      }

      if (filters?.isRecurring !== undefined) {
        where.isRecurring = filters.isRecurring;
      }

      if (filters?.subcategoryId) {
        where.subcategoryId = filters.subcategoryId;
      }

      if (filters?.type) {
        where.type = filters.type;
      }

if (filters?.dateFrom || filters?.dateTo) {
  where.date = {};

  if (filters.dateFrom) {
    where.date.gte = new Date(filters.dateFrom);
  }

  if (filters.dateTo) {
    const toExclusive = new Date(filters.dateTo);

    // sumamos 1 día y usamos lt (exclusivo) para incluir TODO el día dateTo
    toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

    where.date.lt = toExclusive;
  }
}


      const transactions = await this.prisma.transaction.findMany({
        where,
        include: {
          category: true,
          subcategory: true,
          wallet: true,
          fromWallet: true,
          toWallet: true,
          project: true,
          planItems: { select: { transactionId: true, metadata: true } },
          investmentAsset: { select: { id: true, name: true, abbreviation: true } },
        },
        orderBy: { date: 'desc' },
      });

      return PrismaDateTransformer.toPlain(transactions);
    } catch (error) {
      if (error instanceof BadRequestException) throw error;

      throw new InternalServerErrorException(
        'Ocurrió un error al obtener las transacciones. Inténtalo de nuevo más tarde.',
      );
    }
  }
  

  // ============================================================
  // FIND ONE
  // ============================================================
  async findOne(userId: number, id: number) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true },
      include: {
        planItems: { select: { transactionId: true, metadata: true } },
      },
    });

    if (!tx) throw new NotFoundException('Transaction not found');

    return PrismaDateTransformer.toPlain(tx);
  }

  // ============================================================
  // UPDATE (manteniendo balance correcto)
  // ============================================================
  async update(userId: number, id: number, dto: UpdateTransactionDto) {
    const prev = await this.findOne(userId, id);

    // 1️⃣ REVERTIR EFECTO ANTERIOR
    if (prev.type === 'income' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    if (prev.type === 'expense' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { increment: prev.amount } },
      });
    }

    if (prev.type === 'transfer') {
      if (prev.fromWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.fromWalletId },
          data: { balance: { increment: prev.amount } },
        });
      }

      if (prev.toWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.toWalletId },
          data: { balance: { decrement: prev.amount } },
        });
      }
    }

    // 2️⃣ ACTUALIZAR TRANSACCIÓN
    const { tripExpenseCategory, ...dtoAny } = dto as any;
    const hasTripExpenseCategory = Object.prototype.hasOwnProperty.call(
      dto,
      'tripExpenseCategory',
    );
    const updated = await this.prisma.transaction.update({
      where: { id },
      data: dtoAny,
    });

    // Sync linked TripPlanItem cost if one exists for this transaction
    const linkedPlanItem = await this.prisma.tripPlanItem.findFirst({
      where: { transactionId: id },
      select: { id: true, metadata: true },
    });
    if (linkedPlanItem) {
      const currentMetadata =
        linkedPlanItem.metadata &&
        typeof linkedPlanItem.metadata === 'object' &&
        !Array.isArray(linkedPlanItem.metadata)
          ? (linkedPlanItem.metadata as Record<string, unknown>)
          : {};

      await this.prisma.tripPlanItem.update({
        where: { id: linkedPlanItem.id },
        data: {
          cost: updated.amount,
          ...(dtoAny.description ? { title: dtoAny.description } : {}),
          ...(hasTripExpenseCategory
            ? {
                metadata: tripExpenseCategory
                  ? {
                      ...currentMetadata,
                      expenseCategory: tripExpenseCategory,
                      pending: false,
                    }
                  : {
                      ...currentMetadata,
                      expenseCategory: 'other',
                      pending: true,
                    },
              }
            : {}),
        },
      }).catch(() => null);
    } else if (dtoAny.subcategoryId) {
      // If subcategory changed to a viaje one and no planItem exists yet, create it
      const autoTripId = await this.autoResolveTripId(userId, dtoAny.subcategoryId).catch(() => undefined);
      if (autoTripId != null) {
        await this.prisma.tripPlanItem.create({
          data: {
            tripId: autoTripId,
            type: 'expense',
            title: updated.description || 'Gasto',
            cost: updated.amount,
            date: updated.date,
            startTime: updated.date,
            transactionId: id,
            metadata: tripExpenseCategory
              ? { expenseCategory: tripExpenseCategory, autoCreatedFromTransaction: true }
              : { expenseCategory: 'other', pending: true, autoCreatedFromTransaction: true },
          },
        }).catch(() => null);
      }
    }

    // 3️⃣ APLICAR EFECTO NUEVO
    if (updated.type === 'income' && updated.walletId) {
      await this.prisma.wallet.update({
        where: { id: updated.walletId },
        data: { balance: { increment: updated.amount } },
      });
    }

    if (updated.type === 'expense' && updated.walletId) {
      await this.prisma.wallet.update({
        where: { id: updated.walletId },
        data: { balance: { decrement: updated.amount } },
      });
    }

    if (updated.type === 'transfer') {
      // ✅ validación inversión también en update (por si cambian toWalletId)
      if (updated.toWalletId) {
        const toWallet = await this.prisma.wallet.findUnique({
          where: { id: updated.toWalletId },
        });
        if (toWallet?.kind === 'investment' && !(updated as any).investmentAssetId) {
          throw new BadRequestException(
            'investmentAssetId es obligatorio cuando el destino es una wallet de inversión',
          );
        }
      }

      if (updated.fromWalletId) {
        await this.prisma.wallet.update({
          where: { id: updated.fromWalletId },
          data: { balance: { decrement: updated.amount } },
        });
      }

      if (updated.toWalletId) {
        await this.prisma.wallet.update({
          where: { id: updated.toWalletId },
          data: { balance: { increment: updated.amount } },
        });
      }
    }

    return PrismaDateTransformer.toPlain(updated);
  }

  // ============================================================
  // REMOVE (revirtiendo balance correctamente)
  // ============================================================
  async remove(userId: number, id: number) {
    const prev = await this.findOne(userId, id);

    // Revertir efecto previo
    if (prev.type === 'income' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { decrement: prev.amount } },
      });
    }

    if (prev.type === 'expense' && prev.walletId) {
      await this.prisma.wallet.update({
        where: { id: prev.walletId },
        data: { balance: { increment: prev.amount } },
      });
    }

    if (prev.type === 'transfer') {
      if (prev.fromWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.fromWalletId },
          data: { balance: { increment: prev.amount } },
        });
      }

      if (prev.toWalletId) {
        await this.prisma.wallet.update({
          where: { id: prev.toWalletId },
          data: { balance: { decrement: prev.amount } },
        });
      }
    }

    // Soft delete
    const removed = await this.prisma.transaction.update({
      where: { id },
      data: { active: false },
    });

    // Un plan item ligado a esta transacción puede venir de dos sitios muy
    // distintos: (a) se creó automáticamente junto con la transacción (gasto
    // pendiente o clasificado) — al borrar la transacción no tiene sentido
    // que sobreviva solo, se borra también; (b) ya existía en el itinerario
    // (vuelo, alojamiento...) y el usuario solo lo vinculó desde "Vincular al
    // plan" — ese item es del itinerario, no de la transacción: solo se
    // desvincula (se le quita el coste), nunca se borra.
    const linkedItems = await this.prisma.tripPlanItem.findMany({
      where: { transactionId: id },
      select: { id: true, metadata: true },
    });
    const autoCreatedIds = linkedItems
      .filter((it) => (it.metadata as any)?.autoCreatedFromTransaction === true)
      .map((it) => it.id);
    const manuallyLinkedIds = linkedItems
      .filter((it) => (it.metadata as any)?.autoCreatedFromTransaction !== true)
      .map((it) => it.id);

    if (autoCreatedIds.length) {
      await this.prisma.tripPlanItem.deleteMany({
        where: { id: { in: autoCreatedIds } },
      }).catch(() => null);
    }
    if (manuallyLinkedIds.length) {
      await this.prisma.tripPlanItem.updateMany({
        where: { id: { in: manuallyLinkedIds } },
        data: { transactionId: null, cost: null },
      }).catch(() => null);
    }

    return PrismaDateTransformer.toPlain(removed);
  }

  // ============================================================
  // RECURRING ENGINE (CRON)
  // ============================================================
  async processRecurringTransactions() {
    const now = new Date();

    const templates = await this.prisma.transaction.findMany({
      where: {
        isRecurring: true,
        recurrence: { not: null },
        date: { lte: now }, // ya toca ejecutarlas
        active: true,
        paused: false,
      },
      include: { category: true, subcategory: true },
    });

    for (const t of templates) {
      // Serie con fecha fin ya superada: no genera más ocurrencias. Se deja
      // la plantilla tal cual (el front la muestra como "Finalizada" a
      // partir de endDate, sin necesidad de un estado aparte aquí).
      if ((t as any).endDate && new Date((t as any).endDate).getTime() < now.getTime()) {
        continue;
      }

      // 1) DTO para la transacción real (ocurrencia)
      const dto: CreateTransactionDto = {
        type: t.type as any,
        amount: t.amount,
        description: t.description ?? undefined,
        // guardamos la fecha programada como fecha del movimiento
        date: t.date.toISOString(),
        walletId: t.walletId ?? undefined,
        fromWalletId: t.fromWalletId ?? undefined,
        toWalletId: t.toWalletId ?? undefined,

        // ✅ clave para aportaciones recurrentes a inversión
        investmentAssetId: (t as any).investmentAssetId ?? undefined,

        categoryId: t.categoryId ?? undefined,
        subcategoryId: t.subcategoryId ?? undefined,
        tripId: t.tripId ?? undefined,
        projectId: (t as any).projectId ?? undefined,
        // la ocurrencia NO es recurrente
        isRecurring: false,
        recurrence: null,
        // enlazamos con la plantilla
        parentId: t.id,
      } as any;

      // 2) crear la transacción pasando por la lógica normal (balances, validaciones, etc.)
      await this.create(t.userId, dto);

      // 2b) disparar notificación push (no bloqueante)
      this.notifications
        .notifyRecurringTransactionExecuted({
          userId: t.userId,
          note: t.description ?? undefined,
          category: t.category?.name ?? undefined,
          subcategory: t.subcategory?.name ?? undefined,
          amount: t.amount,
          type: t.type as 'income' | 'expense' | 'transfer',
        })
        .catch(() => null);

      // 3) calcular siguiente fecha para la plantilla
      const nextDate = this.getNextDate(t.date, t.recurrence);

      // 4) actualizar plantilla recurrente
      await this.prisma.transaction.update({
        where: { id: t.id },
        data: { date: nextDate },
      });
    }
  }

  // ============================================================
  // HELPER: calcular siguiente fecha de ejecución
  // ============================================================
  private getNextDate(current: Date, interval: string | null): Date {
    const d = new Date(current);
    switch (interval) {
      case 'daily':
        d.setDate(d.getDate() + 1);
        break;
      case 'weekly':
        d.setDate(d.getDate() + 7);
        break;
      case 'monthly':
        d.setMonth(d.getMonth() + 1);
        break;
      case 'quarterly':
        d.setMonth(d.getMonth() + 3);
        break;
      case 'yearly':
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
    return d;
  }

  // Repite getNextDate hasta superar `now` — usado al reanudar una plantilla
  // que estuvo pausada un tiempo, para no disparar de golpe todas las
  // ejecuciones que se saltó mientras tanto.
  private advanceToFuture(current: Date, interval: string | null, now: Date): Date {
    let d = current;
    let guard = 0;
    while (d.getTime() <= now.getTime() && guard < 10000) {
      d = this.getNextDate(d, interval);
      guard += 1;
    }
    return d;
  }

  // ============================================================
  // PAUSAR / REANUDAR una plantilla recurrente
  // ============================================================
  async setRecurringPaused(userId: number, id: number, paused: boolean) {
    const template = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true, isRecurring: true },
    });

    if (!template) {
      throw new NotFoundException('Recurring transaction not found');
    }

    const data: any = { paused };

    // Al reanudar, si la próxima fecha quedó en el pasado, se salta al
    // próximo futuro en lugar de dejar que el cron dispare pagos atrasados.
    if (!paused && template.date.getTime() < Date.now()) {
      data.date = this.advanceToFuture(template.date, template.recurrence, new Date());
    }

    await this.prisma.transaction.update({ where: { id }, data });

    return this.findOne(userId, id);
  }

  async updateWithScope(
    userId: number,
    id: number,
    dto: UpdateTransactionDto,
    scope: 'single' | 'series' | 'future' = 'single',
  ) {
    // 1) Obtenemos la transacción base (la que el usuario está editando)
    const baseTx = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true },
    });

    if (!baseTx) {
      throw new NotFoundException('Transaction not found');
    }

    const isInSeries = baseTx.isRecurring || !!baseTx.parentId;

    // ✅ Caso 1: no pertenece a serie o el usuario ha elegido "solo esta"
    if (!isInSeries || scope === 'single') {
      return this.update(userId, id, dto);
    }

    // 2) Identificar plantilla de la serie
    const templateId = baseTx.isRecurring ? baseTx.id : baseTx.parentId;

    if (!templateId) {
      return this.update(userId, id, dto);
    }

    const templateTx = await this.prisma.transaction.findFirst({
      where: { id: templateId, userId, active: true },
    });

    if (!templateTx) {
      return this.update(userId, id, dto);
    }

    // 3) Actualizar la plantilla (no toca balances)
    const templateUpdateData: any = {
      type: dto.type ?? templateTx.type,
      amount: dto.amount ?? templateTx.amount,
      description: dto.description ?? templateTx.description,
      categoryId:
        typeof (dto as any).categoryId !== 'undefined'
          ? (dto as any).categoryId
          : templateTx.categoryId,
      subcategoryId:
        typeof (dto as any).subcategoryId !== 'undefined'
          ? (dto as any).subcategoryId
          : templateTx.subcategoryId,
      walletId:
        typeof (dto as any).walletId !== 'undefined'
          ? (dto as any).walletId
          : templateTx.walletId,
      fromWalletId:
        typeof (dto as any).fromWalletId !== 'undefined'
          ? (dto as any).fromWalletId
          : templateTx.fromWalletId,
      toWalletId:
        typeof (dto as any).toWalletId !== 'undefined'
          ? (dto as any).toWalletId
          : templateTx.toWalletId,

      // ✅ clave: propagar investmentAssetId en series
      investmentAssetId:
        typeof (dto as any).investmentAssetId !== 'undefined'
          ? (dto as any).investmentAssetId
          : (templateTx as any).investmentAssetId,
      projectId:
        typeof (dto as any).projectId !== 'undefined'
          ? (dto as any).projectId
          : (templateTx as any).projectId,
      endDate:
        typeof (dto as any).endDate !== 'undefined'
          ? (dto as any).endDate
            ? new Date((dto as any).endDate)
            : null
          : (templateTx as any).endDate,
    };

    // En la plantilla, `date` es la PRÓXIMA ejecución (es la que enseña la
    // lista de recurrentes y la que usa el cron). Si se edita la propia
    // plantilla hay que guardarla: los hijos ya generados son movimientos
    // pasados y no la cambian. Si se edita una ocurrencia, su fecha no toca la
    // de la plantilla.
    if (baseTx.isRecurring && (dto as any).date) {
      const newDate = new Date((dto as any).date);
      if (isNaN(newDate.getTime())) {
        throw new BadRequestException('Fecha inválida');
      }
      templateUpdateData.date = newDate;
    }

    // isRecurring + recurrence para la plantilla
    if (typeof (dto as any).recurrence !== 'undefined') {
      if ((dto as any).recurrence) {
        templateUpdateData.isRecurring = true;
        templateUpdateData.recurrence = (dto as any).recurrence;
      } else {
        templateUpdateData.isRecurring = false;
        templateUpdateData.recurrence = null;
      }
    }

    await this.prisma.transaction.update({
      where: { id: templateId },
      data: templateUpdateData,
    });

    // `paused`/`endDate` son conceptos de la plantilla, no de una ocurrencia
    // ya generada: nunca se propagan a los hijos al editar en cascada.
    const { paused: _paused, endDate: _endDate, ...dtoForChildrenBase } = dto as any;

    // ✅ Caso 2: actualizar esta + futuras
    if (scope === 'future') {
      const futureChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
          date: { gte: baseTx.date },
        },
      });

      for (const child of futureChildren) {
        const dtoForChild: UpdateTransactionDto = {
          ...dtoForChildrenBase,
          date: dtoForChildrenBase.date ?? child.date.toISOString(),
        };
        await this.update(userId, child.id, dtoForChild);
      }

      return this.findOne(userId, id);
    }

    // ✅ Caso 3: actualizar toda la serie
    if (scope === 'series') {
      const allChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
        },
      });

      for (const child of allChildren) {
        const dtoForChild: UpdateTransactionDto = {
          ...dtoForChildrenBase,
          date: dtoForChildrenBase.date ?? child.date.toISOString(),
        };
        await this.update(userId, child.id, dtoForChild);
      }

      return this.findOne(userId, id);
    }

    return this.update(userId, id, dto);
  }

  async removeWithScope(
    userId: number,
    id: number,
    scope: 'single' | 'series' | 'future' = 'single',
  ) {
    const baseTx = await this.prisma.transaction.findFirst({
      where: { id, userId, active: true },
    });

    if (!baseTx) {
      throw new NotFoundException('Transaction not found');
    }

    const isInSeries = baseTx.isRecurring || !!baseTx.parentId;

    if (!isInSeries || scope === 'single') {
      return this.remove(userId, id);
    }

    const templateId = baseTx.isRecurring ? baseTx.id : baseTx.parentId;

    if (!templateId) {
      return this.remove(userId, id);
    }

    let deletedCount = 0;

    if (scope === 'future') {
      if (baseTx.parentId) {
        await this.remove(userId, baseTx.id);
        deletedCount++;
      }

      const futureChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
          date: { gt: baseTx.date },
        },
      });

      for (const child of futureChildren) {
        await this.remove(userId, child.id);
        deletedCount++;
      }

      await this.prisma.transaction.update({
        where: { id: templateId },
        data: { active: false },
      });

      return { scope, deletedCount };
    }

    if (scope === 'series') {
      const allChildren = await this.prisma.transaction.findMany({
        where: {
          userId,
          active: true,
          parentId: templateId,
        },
      });

      for (const child of allChildren) {
        await this.remove(userId, child.id);
        deletedCount++;
      }

      await this.prisma.transaction.update({
        where: { id: templateId },
        data: { active: false },
      });

      return { scope, deletedCount };
    }

    return this.remove(userId, id);
  }

  // dentro de TransactionsService

async findLastSalary(userId: number) {
  try {
    // 1) Buscar categoría "Salario" del usuario (category o subcategory, según tu modelo)
    // Ajusta el where si tu categoría de salario vive en subcategory en vez de category.
    const salaryCategory = await this.prisma.category.findFirst({
      where: {
        userId,
        active: true,
        name: { equals: 'Salario', mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });

    // Si no existe categoría salario, no tiene sentido seguir
    if (!salaryCategory) {
      throw new NotFoundException('No existe la categoría "Salario"');
    }

    // 2) Obtener última transacción income en esa categoría
    // Importante: ignoramos recurrent templates (isRecurring=true) y soft-deleted (active=false)
    const tx = await this.prisma.transaction.findFirst({
      where: {
        userId,
        active: true,
        isRecurring: false,
        type: 'income',
        categoryId: salaryCategory.id,
      },
      orderBy: { date: 'desc' },
      select: {
        id: true,
        amount: true,
        date: true,
        description: true,
        walletId: true,
        category: { select: { id: true, name: true } },
        subcategory: { select: { id: true, name: true } },
      },
    });

    if (!tx) {
      throw new NotFoundException('No hay transacciones de salario');
    }

    // 3) Respuesta pequeña y directa (ideal para tu modal)
    return PrismaDateTransformer.toPlain({
      id: tx.id,
      amount: Number(tx.amount),
      date: tx.date,
      description: tx.description,
      walletId: tx.walletId,
      category: tx.category,
      subcategory: tx.subcategory,
    });
  } catch (error) {
    if (error instanceof NotFoundException) throw error;
    if (error instanceof BadRequestException) throw error;

    throw new InternalServerErrorException(
      'Ocurrió un error al obtener el último salario. Inténtalo de nuevo más tarde.',
    );
  }
}

}
