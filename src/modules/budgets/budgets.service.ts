import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { BudgetPeriod, Prisma } from "@prisma/client";
import { CreateBudgetDto } from "./dto/create-budget.dto";
import { UpdateBudgetDto } from "./dto/update-budget.dto";
import { BudgetCategoryLimitDto } from "./dto/budget-category-limit.dto";
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

// Rango del periodo inmediatamente anterior al indicado (para el cálculo de "sobrante").
function previousPeriodRange(period: BudgetPeriod, current: PeriodRange): PeriodRange {
  switch (period) {
    case "daily": {
      const ref = new Date(current.from);
      ref.setDate(ref.getDate() - 1);
      return computeRange("daily", ref);
    }
    case "weekly": {
      const ref = new Date(current.from);
      ref.setDate(ref.getDate() - 7);
      return computeRange("weekly", ref);
    }
    case "yearly": {
      const ref = new Date(current.from.getFullYear() - 1, 5, 15);
      return computeRange("yearly", ref);
    }
    case "monthly":
    default: {
      const ref = new Date(current.from.getFullYear(), current.from.getMonth() - 1, 15);
      return computeRange("monthly", ref);
    }
  }
}

// Fecha de referencia desplazada `steps` periodos (negativo = hacia el pasado),
// usada para reconstruir los periodos históricos de un budget concreto.
function stepRefDate(period: BudgetPeriod, ref: Date, steps: number): Date {
  switch (period) {
    case "daily": {
      const d = new Date(ref);
      d.setDate(d.getDate() + steps);
      return d;
    }
    case "weekly": {
      const d = new Date(ref);
      d.setDate(d.getDate() + steps * 7);
      return d;
    }
    case "yearly":
      return new Date(ref.getFullYear() + steps, 5, 15);
    case "monthly":
    default:
      return new Date(ref.getFullYear(), ref.getMonth() + steps, 15);
  }
}

const BUDGET_WITH_LIMITS_INCLUDE = {
  categoryLimits: { include: { category: true } },
} satisfies Prisma.BudgetInclude;

type BudgetWithLimits = Prisma.BudgetGetPayload<{ include: typeof BUDGET_WITH_LIMITS_INCLUDE }>;

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  // Un presupuesto debe tener límite global y/o al menos un límite por categoría,
  // nunca ninguno; las categorías no pueden repetirse; los sublímites no pueden
  // superar el límite global si este existe.
  private validateLimits(totalLimit: number | null | undefined, categoryLimits: BudgetCategoryLimitDto[]) {
    const limits = categoryLimits ?? [];

    if ((totalLimit == null) && limits.length === 0) {
      throw new BadRequestException("Debes indicar un límite total o al menos un límite por categoría.");
    }

    const ids = limits.map((c) => c.categoryId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException("Una categoría no puede repetirse en el mismo presupuesto.");
    }

    for (const c of limits) {
      if (!(c.limit > 0)) {
        throw new BadRequestException("Los límites por categoría deben ser mayores que 0.");
      }
    }

    if (totalLimit != null) {
      if (!(totalLimit > 0)) {
        throw new BadRequestException("El límite total debe ser mayor que 0.");
      }
      const sum = limits.reduce((s, c) => s + c.limit, 0);
      if (sum > totalLimit) {
        throw new BadRequestException("Los límites por categoría no pueden superar el límite total.");
      }
    }
  }

  private async attachWallets<T extends { walletIds: number[] }>(items: T[]) {
    const allIds = Array.from(new Set(items.flatMap((i) => i.walletIds || [])));
    if (allIds.length === 0) return items.map((i) => ({ ...i, wallets: [] as any[] }));

    const wallets = await this.prisma.wallet.findMany({
      where: { id: { in: allIds } },
      select: { id: true, name: true, emoji: true, currency: true },
    });
    const map = new Map(wallets.map((w) => [w.id, w]));
    return items.map((i) => ({ ...i, wallets: (i.walletIds || []).map((id) => map.get(id)).filter(Boolean) as any[] }));
  }

  // Calcula el progreso de un budget (límite global + sublímites por categoría)
  // para un rango de fechas concreto. `prevRange` se usa solo si el budget tiene
  // carryOverRemaining activo y límite global, para calcular el sobrante del
  // periodo inmediatamente anterior.
  private async computeBudgetProgress(userId: number, b: BudgetWithLimits, range: PeriodRange, prevRange: PeriodRange) {
    const walletFilter: Prisma.TransactionWhereInput = b.walletIds?.length ? { walletId: { in: b.walletIds } } : {};

    const baseWhere: Prisma.TransactionWhereInput = {
      userId,
      active: true,
      excludeFromStats: false,
      isRecurring: false,
      type: "expense",
      date: { gte: range.from, lte: range.to },
      ...walletFilter,
    };

    const totalAgg = await this.prisma.transaction.aggregate({ where: baseWhere, _sum: { amount: true } });
    const totalSpentRaw = totalAgg._sum.amount ?? 0;

    const categoryItems: any[] = [];
    let sumLimitedCategoriesSpent = 0;

    for (const cl of b.categoryLimits) {
      const agg = await this.prisma.transaction.aggregate({
        where: { ...baseWhere, categoryId: cl.categoryId },
        _sum: { amount: true },
      });
      const spent = agg._sum.amount ?? 0;
      sumLimitedCategoriesSpent += spent;

      categoryItems.push({
        categoryId: cl.categoryId,
        category: cl.category
          ? { id: cl.category.id, name: cl.category.name, emoji: cl.category.emoji, color: cl.category.color }
          : null,
        limit: cl.limit,
        spent,
        remaining: Math.max(cl.limit - spent, 0),
        // Sin tope en 1: si se supera el límite, progress puede pasar de 1 (p.ej. 1.1 = 110%).
        // Quien pinte una barra debe capar el ANCHO visualmente, pero el % mostrado no.
        progress: cl.limit > 0 ? spent / cl.limit : 0,
      });
    }

    const hasGlobal = b.totalLimit != null;
    let carryOverAmount = 0;

    if (hasGlobal && b.carryOverRemaining && new Date(b.startDate) <= prevRange.to) {
      const prevAgg = await this.prisma.transaction.aggregate({
        where: {
          userId,
          active: true,
          excludeFromStats: false,
          isRecurring: false,
          type: "expense",
          date: { gte: prevRange.from, lte: prevRange.to },
          ...walletFilter,
        },
        _sum: { amount: true },
      });
      const prevSpent = prevAgg._sum.amount ?? 0;
      carryOverAmount = Math.max((b.totalLimit as number) - prevSpent, 0);
    }

    const effectiveTotalLimit = hasGlobal ? (b.totalLimit as number) + carryOverAmount : null;
    const globalSpent = hasGlobal ? totalSpentRaw : null;
    const globalRemaining = hasGlobal ? Math.max((effectiveTotalLimit as number) - (globalSpent as number), 0) : null;
    const globalProgress = hasGlobal
      ? (effectiveTotalLimit as number) > 0
        ? (globalSpent as number) / (effectiveTotalLimit as number)
        : 0
      : null;
    // "Resto de gastos": gasto incluido en el límite global cuya categoría no
    // tiene un sublímite específico. No es una categoría real.
    const otherSpent = hasGlobal ? Math.max(totalSpentRaw - sumLimitedCategoriesSpent, 0) : null;

    return {
      totalLimit: b.totalLimit,
      carryOverAmount,
      effectiveTotalLimit,
      globalSpent,
      globalRemaining,
      globalProgress,
      otherSpent,
      categoryLimits: categoryItems,
    };
  }

  // CRUD básico
  async findAll(userId: number) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, active: true },
      include: BUDGET_WITH_LIMITS_INCLUDE,
      orderBy: { createdAt: "desc" },
    });
    return this.attachWallets(budgets);
  }

  async findOne(userId: number, id: number) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId, active: true },
      include: BUDGET_WITH_LIMITS_INCLUDE,
    });
    if (!budget) throw new NotFoundException("Budget not found");
    const [withWallets] = await this.attachWallets([budget]);
    return withWallets;
  }

  // Evolución histórica de un budget concreto a lo largo de sus últimos `count`
  // periodos (incluido el actual), con el mismo cálculo que overview().
  async history(userId: number, id: number, query: { count?: number }) {
    const budget = await this.findOne(userId, id);

    const count = Math.min(Math.max(Number(query.count) || 6, 1), 24);
    const now = new Date();
    const startDate = new Date(budget.startDate);

    const ranges: PeriodRange[] = [];
    for (let i = count - 1; i >= 0; i--) {
      const ref = stepRefDate(budget.period, now, -i);
      ranges.push(computeRange(budget.period, ref));
    }

    const relevantRanges = ranges.filter((r) => r.to >= startDate);
    const items: any[] = [];

    for (const range of relevantRanges) {
      const clamped = clampFromToBudgetStart(range, startDate);
      const prevRange = previousPeriodRange(budget.period, range);
      const progress = await this.computeBudgetProgress(userId, budget, clamped, prevRange);

      items.push({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        ...progress,
      });
    }

    items.reverse();

    const withGlobal = items.filter((i) => i.effectiveTotalLimit != null);
    const monthsOverBudget = withGlobal.filter((i) => (i.globalSpent ?? 0) > (i.effectiveTotalLimit ?? 0)).length;
    const avgSpent = withGlobal.length ? withGlobal.reduce((s, i) => s + (i.globalSpent ?? 0), 0) / withGlobal.length : 0;
    const avgProgress = withGlobal.length ? withGlobal.reduce((s, i) => s + (i.globalProgress ?? 0), 0) / withGlobal.length : 0;

    return {
      budget: {
        id: budget.id,
        name: budget.name,
        period: budget.period,
        totalLimit: budget.totalLimit,
        autoRenew: budget.autoRenew,
        carryOverRemaining: budget.carryOverRemaining,
        categoryLimits: budget.categoryLimits.map((cl) => ({
          categoryId: cl.categoryId,
          limit: cl.limit,
          category: cl.category
            ? { id: cl.category.id, name: cl.category.name, emoji: cl.category.emoji, color: cl.category.color }
            : null,
        })),
      },
      summary: {
        count: items.length,
        hasGlobal: budget.totalLimit != null,
        monthsOverBudget,
        monthsUnderBudget: withGlobal.length - monthsOverBudget,
        avgSpent,
        avgProgress,
      },
      items,
    };
  }

  // Progreso de un budget concreto para un periodo (el actual por defecto).
  // Pensado para la pantalla de detalle: reutiliza exactamente el mismo cálculo
  // que overview(), pero para un único presupuesto.
  async progress(userId: number, id: number, query: { date?: string }) {
    const budget = await this.findOne(userId, id);
    const refDate = query.date ? new Date(query.date) : new Date();

    const baseRange = computeRange(budget.period, refDate);
    const prevRange = previousPeriodRange(budget.period, baseRange);
    const clamped = clampFromToBudgetStart(baseRange, new Date(budget.startDate));

    const progressData = await this.computeBudgetProgress(userId, budget, clamped, prevRange);

    return {
      id: budget.id,
      name: budget.name,
      period: budget.period,
      startDate: new Date(budget.startDate).toISOString(),
      autoRenew: budget.autoRenew,
      carryOverRemaining: budget.carryOverRemaining,
      walletIds: budget.walletIds,
      wallets: (budget as any).wallets ?? [],
      range: { from: clamped.from.toISOString(), to: clamped.to.toISOString() },
      ...progressData,
    };
  }

  async create(userId: number, dto: CreateBudgetDto) {
    const categoryLimits = dto.categoryLimits ?? [];
    this.validateLimits(dto.totalLimit ?? null, categoryLimits);

    const budget = await this.prisma.budget.create({
      data: {
        userId,
        name: dto.name?.trim() || null,
        period: dto.period ?? "monthly",
        startDate: new Date(dto.startDate),
        totalLimit: dto.totalLimit ?? null,
        walletIds: dto.walletIds ?? [],
        autoRenew: dto.autoRenew ?? true,
        carryOverRemaining: dto.carryOverRemaining ?? false,
        categoryLimits: {
          create: categoryLimits.map((c) => ({ categoryId: c.categoryId, limit: c.limit })),
        },
      },
      include: BUDGET_WITH_LIMITS_INCLUDE,
    });

    const [withWallets] = await this.attachWallets([budget]);
    return withWallets;
  }

  async update(userId: number, id: number, dto: UpdateBudgetDto) {
    const existing = await this.findOne(userId, id);

    const effectiveTotalLimit = dto.totalLimit !== undefined ? dto.totalLimit : existing.totalLimit;
    const effectiveCategoryLimits: BudgetCategoryLimitDto[] =
      dto.categoryLimits !== undefined
        ? dto.categoryLimits
        : existing.categoryLimits.map((cl) => ({ categoryId: cl.categoryId, limit: cl.limit }));

    this.validateLimits(effectiveTotalLimit ?? null, effectiveCategoryLimits);

    const ops: Prisma.PrismaPromise<any>[] = [
      this.prisma.budget.update({
        where: { id },
        data: {
          name: dto.name !== undefined ? dto.name?.trim() || null : undefined,
          period: dto.period ?? undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          totalLimit: dto.totalLimit !== undefined ? dto.totalLimit : undefined,
          walletIds: dto.walletIds !== undefined ? dto.walletIds : undefined,
          autoRenew: dto.autoRenew !== undefined ? dto.autoRenew : undefined,
          carryOverRemaining: dto.carryOverRemaining !== undefined ? dto.carryOverRemaining : undefined,
        },
      }),
    ];

    if (dto.categoryLimits !== undefined) {
      ops.push(this.prisma.budgetCategoryLimit.deleteMany({ where: { budgetId: id } }));
      if (dto.categoryLimits.length > 0) {
        ops.push(
          this.prisma.budgetCategoryLimit.createMany({
            data: dto.categoryLimits.map((c) => ({ budgetId: id, categoryId: c.categoryId, limit: c.limit })),
          })
        );
      }
    }

    await this.prisma.$transaction(ops);

    return this.findOne(userId, id);
  }

  // Archivar: soft-delete (deja de aparecer, pero conserva su histórico de gasto).
  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    return this.prisma.budget.update({
      where: { id },
      data: { active: false },
    });
  }

  // Eliminar de forma permanente (incluidos sus categoryLimits, por cascade).
  // No filtra por active: también permite borrar un presupuesto ya archivado.
  async hardDelete(userId: number, id: number) {
    const budget = await this.prisma.budget.findFirst({ where: { id, userId } });
    if (!budget) throw new NotFoundException("Budget not found");
    await this.prisma.budget.delete({ where: { id } });
    return { success: true };
  }

  // OVERVIEW (sin historial)
  async overview(userId: number, query: BudgetsOverviewQueryDto) {
    const refDate = query.date ? new Date(query.date) : new Date();

    const budgets = await this.prisma.budget.findMany({
      where: {
        userId,
        active: true,
        ...(query.period ? { period: query.period } : {}),
      },
      include: BUDGET_WITH_LIMITS_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    if (budgets.length === 0) {
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

    const periods = Array.from(new Set(budgets.map((b) => b.period)));
    const overviewBudgets: any[] = [];
    let summaryTotalLimit = 0;
    let summaryTotalSpent = 0;

    for (const period of periods) {
      const periodBudgets = budgets.filter((b) => b.period === period);
      const baseRange = computeRange(period, refDate);
      const prevRange = previousPeriodRange(period, baseRange);

      // Si autoRenew=false, el presupuesto es único para el periodo en el que fue
      // creado: solo debe aparecer cuando el periodo consultado coincide con el
      // periodo de su propia startDate.
      const renewableBudgets = periodBudgets.filter((b) => {
        if (b.autoRenew) return true;
        const ownRange = computeRange(period, new Date(b.startDate));
        return ownRange.from.getTime() === baseRange.from.getTime();
      });

      for (const b of renewableBudgets) {
        const clamped = clampFromToBudgetStart(baseRange, new Date(b.startDate));
        const progress = await this.computeBudgetProgress(userId, b, clamped, prevRange);

        if (progress.effectiveTotalLimit != null) {
          summaryTotalLimit += progress.effectiveTotalLimit;
          summaryTotalSpent += progress.globalSpent ?? 0;
        }

        overviewBudgets.push({
          id: b.id,
          name: b.name,
          period: b.period,
          startDate: new Date(b.startDate).toISOString(),
          autoRenew: b.autoRenew,
          carryOverRemaining: b.carryOverRemaining,
          walletIds: b.walletIds,
          range: { from: clamped.from.toISOString(), to: clamped.to.toISOString() },
          ...progress,
        });
      }
    }

    const withWallets = await this.attachWallets(overviewBudgets);
    const summaryRemaining = Math.max(summaryTotalLimit - summaryTotalSpent, 0);

    return {
      // Nota: aquí devolvemos “mixed periods”; el front puede agrupar por period si quiere.
      period: query.period ?? null,
      date: refDate.toISOString(),
      summary: {
        totalLimit: summaryTotalLimit,
        totalSpent: summaryTotalSpent,
        remaining: summaryRemaining,
        count: withWallets.length,
      },
      budgets: withWallets,
    };
  }
}
