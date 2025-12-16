import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { BudgetPeriod, Prisma } from "@prisma/client";
import { CreateBudgetDto } from "./dto/create-budget.dto";
import { UpdateBudgetDto } from "./dto/update-budget.dto";
import { BudgetsOverviewQueryDto } from "./dto/budgets-overview.query.dto";

type PeriodRange = { from: Date; to: Date };

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

// Semana ISO (lunes inicio) – España
function startOfWeekMonday(d: Date) {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 domingo ... 6 sábado
  const diff = (day === 0 ? -6 : 1) - day; // lunes=1
  x.setDate(x.getDate() + diff);
  return x;
}
function endOfWeekSunday(d: Date) {
  const s = startOfWeekMonday(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return endOfDay(e);
}

function startOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), 1);
  return startOfDay(x);
}
function endOfMonth(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return endOfDay(x);
}

function startOfYear(d: Date) {
  return startOfDay(new Date(d.getFullYear(), 0, 1));
}
function endOfYear(d: Date) {
  return endOfDay(new Date(d.getFullYear(), 11, 31));
}

function computeRange(period: BudgetPeriod, ref: Date): PeriodRange {
  switch (period) {
    case "daily":
      return { from: startOfDay(ref), to: endOfDay(ref) };
    case "weekly":
      return { from: startOfWeekMonday(ref), to: endOfWeekSunday(ref) };
    case "monthly":
      return { from: startOfMonth(ref), to: endOfMonth(ref) };
    case "yearly":
      return { from: startOfYear(ref), to: endOfYear(ref) };
    default:
      return { from: startOfMonth(ref), to: endOfMonth(ref) };
  }
}

function clampFromToBudgetStart(range: PeriodRange, budgetStart: Date): PeriodRange {
  const from = range.from < budgetStart ? budgetStart : range.from;
  return { from, to: range.to };
}

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  // CRUD básico
  async findAll(userId: number) {
    return this.prisma.budget.findMany({
      where: { userId, active: true },
      include: { category: true, wallet: true },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(userId: number, id: number) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId, active: true },
      include: { category: true, wallet: true },
    });
    if (!budget) throw new NotFoundException("Budget not found");
    return budget;
  }

  async create(userId: number, dto: CreateBudgetDto) {
    return this.prisma.budget.create({
      data: {
        userId,
        name: dto.name?.trim() || null,
        period: dto.period ?? "monthly",
        limit: dto.limit,
        startDate: new Date(dto.startDate),
        categoryId: dto.categoryId ?? null,
        walletId: dto.walletId ?? null,
      },
      include: { category: true, wallet: true },
    });
  }

  async update(userId: number, id: number, dto: UpdateBudgetDto) {
    await this.findOne(userId, id);

    return this.prisma.budget.update({
      where: { id },
      data: {
        name: dto.name !== undefined ? (dto.name?.trim() || null) : undefined,
        period: dto.period ?? undefined,
        limit: dto.limit ?? undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        categoryId: dto.categoryId !== undefined ? dto.categoryId : undefined,
        walletId: dto.walletId !== undefined ? dto.walletId : undefined,
      },
      include: { category: true, wallet: true },
    });
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    return this.prisma.budget.update({
      where: { id },
      data: { active: false },
    });
  }

  // OVERVIEW (sin historial)
  async overview(userId: number, query: BudgetsOverviewQueryDto) {
    const refDate = query.date ? new Date(query.date) : new Date();

    // 1) Cargamos budgets activos (opcional filtrar por period)
    const budgets = await this.prisma.budget.findMany({
      where: {
        userId,
        active: true,
        ...(query.period ? { period: query.period } : {}),
      },
      include: {
        category: { select: { id: true, name: true, emoji: true, color: true, type: true } },
        wallet: { select: { id: true, name: true, emoji: true, currency: true, kind: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    if (budgets.length === 0) {
      // devolvemos un rango coherente si period viene; si no, monthly por defecto
      const period = query.period ?? "monthly";
      const baseRange = computeRange(period, refDate);
      return {
        period,
        from: baseRange.from.toISOString(),
        to: baseRange.to.toISOString(),
        summary: { totalLimit: 0, totalSpent: 0, remaining: 0, count: 0 },
        budgets: [],
      };
    }

    // 2) Necesitamos cálculo por periodos: como cada budget puede tener period distinto,
    //    computamos spent por budget con agregación eficiente en dos niveles:
    //    - Totales por wallet (para budgets "generales" sin categoryId)
    //    - Totales por wallet+category (para budgets por categoría)

    // Para limitar queries: agrupamos por cada period distinto presente.
    const periods = Array.from(new Set(budgets.map((b) => b.period)));

    const overviewBudgets: any[] = [];
    let summaryTotalLimit = 0;
    let summaryTotalSpent = 0;

    for (const period of periods) {
      const periodBudgets = budgets.filter((b) => b.period === period);

      const baseRange = computeRange(period, refDate);

      // Rango global del overview (por period actual); cada budget se clampa con su startDate
      // Para agregaciones “globales”, usamos baseRange y luego clamping solo cuando sea necesario.
      // Nota: el clamping cambia el from por budget. Para mantener eficiencia, aplicamos una regla:
      // - Si startDate > baseRange.from, ese budget tiene un rango más corto => lo calculamos con una query puntual.
      // - Si no, entra en el cálculo agregado.
      //
      // Esto evita explotar queries en el caso típico (startDate antiguo).
      const normalBudgets = periodBudgets.filter((b) => new Date(b.startDate) <= baseRange.from);
      const lateStartBudgets = periodBudgets.filter((b) => new Date(b.startDate) > baseRange.from);

      // ---- 2A) Agregados para budgets "normales" (startDate <= periodStart) ----
      // Totales por wallet (para generales)
      const walletGroup = await this.prisma.transaction.groupBy({
        by: ["walletId"],
        where: {
          userId,
          active: true,
          excludeFromStats: false,
          isRecurring: false,
          type: "expense",
          date: { gte: baseRange.from, lte: baseRange.to },
          walletId: { not: null },
        },
        _sum: { amount: true },
      });

      const walletTotals = new Map<number, number>();
      let allWalletsTotal = 0;

      for (const row of walletGroup) {
        if (row.walletId == null) continue;
        const v = row._sum.amount ?? 0;
        walletTotals.set(row.walletId, v);
        allWalletsTotal += v;
      }

      // Totales por wallet+category (para budgets por categoría)
      const walletCategoryGroup = await this.prisma.transaction.groupBy({
        by: ["walletId", "categoryId"],
        where: {
          userId,
          active: true,
          excludeFromStats: false,
          isRecurring: false,
          type: "expense",
          date: { gte: baseRange.from, lte: baseRange.to },
          walletId: { not: null },
          categoryId: { not: null },
        },
        _sum: { amount: true },
      });

      const wcTotals = new Map<string, number>();
      for (const row of walletCategoryGroup) {
        if (row.walletId == null || row.categoryId == null) continue;
        wcTotals.set(`${row.walletId}:${row.categoryId}`, row._sum.amount ?? 0);
      }

      // Helper para budgets normales (sin clamping adicional)
      const spentForNormal = (b: any) => {
        // Budget por categoría
        if (b.categoryId) {
          if (b.walletId) return wcTotals.get(`${b.walletId}:${b.categoryId}`) ?? 0;
          // sin walletId => suma de todas las wallets para esa categoría (no lo tenemos directo; sumamos keys)
          let s = 0;
          for (const [k, v] of wcTotals.entries()) {
            if (k.endsWith(`:${b.categoryId}`)) s += v;
          }
          return s;
        }

        // Budget general (sin categoría)
        if (b.walletId) return walletTotals.get(b.walletId) ?? 0;
        return allWalletsTotal;
      };

      // ---- 2B) Budgets con startDate tardío: query puntual por budget ----
      const spentForLate = async (b: any) => {
        const clamped = clampFromToBudgetStart(baseRange, new Date(b.startDate));

        const where: Prisma.TransactionWhereInput = {
          userId,
          active: true,
          excludeFromStats: false,
          isRecurring: false,
          type: "expense",
          date: { gte: clamped.from, lte: clamped.to },
        };

        if (b.walletId) where.walletId = b.walletId;
        if (b.categoryId) where.categoryId = b.categoryId;

        const agg = await this.prisma.transaction.aggregate({
          where,
          _sum: { amount: true },
        });

        return agg._sum.amount ?? 0;
      };

      // 3) Construimos salida
      for (const b of normalBudgets) {
        const spent = spentForNormal(b);
        const remaining = Math.max(b.limit - spent, 0);
        const progress = b.limit > 0 ? Math.min(spent / b.limit, 1) : 0;

        summaryTotalLimit += b.limit;
        summaryTotalSpent += spent;

        overviewBudgets.push({
          id: b.id,
          name: b.name,
          period: b.period,
          limit: b.limit,
          startDate: new Date(b.startDate).toISOString(),
          categoryId: b.categoryId,
          walletId: b.walletId,
          category: b.category ? { id: b.category.id, name: b.category.name, emoji: b.category.emoji, color: b.category.color } : null,
          wallet: b.wallet ? { id: b.wallet.id, name: b.wallet.name, emoji: b.wallet.emoji, currency: b.wallet.currency, kind: b.wallet.kind } : null,
          range: { from: baseRange.from.toISOString(), to: baseRange.to.toISOString() },
          spent,
          remaining,
          progress,
        });
      }

      for (const b of lateStartBudgets) {
        const clamped = clampFromToBudgetStart(baseRange, new Date(b.startDate));
        const spent = await spentForLate(b);
        const remaining = Math.max(b.limit - spent, 0);
        const progress = b.limit > 0 ? Math.min(spent / b.limit, 1) : 0;

        summaryTotalLimit += b.limit;
        summaryTotalSpent += spent;

        overviewBudgets.push({
          id: b.id,
          name: b.name,
          period: b.period,
          limit: b.limit,
          startDate: new Date(b.startDate).toISOString(),
          categoryId: b.categoryId,
          walletId: b.walletId,
          category: b.category ? { id: b.category.id, name: b.category.name, emoji: b.category.emoji, color: b.category.color } : null,
          wallet: b.wallet ? { id: b.wallet.id, name: b.wallet.name, emoji: b.wallet.emoji, currency: b.wallet.currency, kind: b.wallet.kind } : null,
          range: { from: clamped.from.toISOString(), to: clamped.to.toISOString() },
          spent,
          remaining,
          progress,
        });
      }
    }

    const summaryRemaining = Math.max(summaryTotalLimit - summaryTotalSpent, 0);

    return {
      // Nota: aquí devolvemos “mixed periods”; el front puede agrupar por period si quiere.
      // Si tu pantalla filtra por un period concreto, usa query.period y te vendrá homogéneo.
      period: query.period ?? null,
      date: refDate.toISOString(),
      summary: {
        totalLimit: summaryTotalLimit,
        totalSpent: summaryTotalSpent,
        remaining: summaryRemaining,
        count: overviewBudgets.length,
      },
      budgets: overviewBudgets,
    };
  }
}
