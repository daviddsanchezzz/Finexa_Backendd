// src/reports/reports.service.ts
import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";

function monthRange(month: string) {
  const m = month?.trim();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new BadRequestException("month debe ser YYYY-MM");
  const [y, mm] = m.split("-").map(Number);
  const start = new Date(Date.UTC(y, mm - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, mm, 1, 0, 0, 0));
  return { start, end };
}

function prevMonth(month: string) {
  const [y, mm] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y2 = d.getUTCFullYear();
  const m2 = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y2}-${m2}`;
}

function yearRange(year: string) {
  const y = year?.trim();
  if (!/^\d{4}$/.test(y)) throw new BadRequestException("year debe ser YYYY");
  const Y = Number(y);
  const start = new Date(Date.UTC(Y, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(Y + 1, 0, 1, 0, 0, 0));
  return { start, end };
}

function prevYear(year: string) {
  const Y = Number(year);
  return String(Y - 1);
}

type CategoryAmount = {
  categoryId: number;
  name: string;
  amount: number;
  emoji: string | null;
  color: string | null;
};

type InvestmentOpRow = {
  id: number;
  date: string;
  type: string;
  amount: number;
  fee: number;
  transactionId: number | null;
  swapGroupId: number | null;
  asset: { id: number; name: string; type: string; identificator: string | null; currency: string | null };
};


type SubcategoryAmount = {
  subcategoryId: number;
  categoryId: number | null; // para poder agrupar por categoría
  name: string;
  amount: number;
  emoji: string | null;
  color: string | null;
};

// Formato “opción 2”: categoría + subcategorías
type CategoryWithSubs = {
  categoryId: number;
  name: string;
  emoji: string | null;
  color: string | null;
  amount: number; // total de la categoría (en el periodo)
  subcategories: Array<{
    subcategoryId: number;
    name: string;
    amount: number;
    emoji: string | null;
    color: string | null;
  }>;
};

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  private delta(cur: number, prev: number) {
    return {
      value: cur - prev,
      pct: prev !== 0 ? (cur - prev) / prev : null,
    };
  }

  // -----------------------------
  // Category helpers
  // -----------------------------
  private async getCategoriesMap(categoryIds: number[]) {
    const ids = Array.from(new Set(categoryIds)).filter(Boolean) as number[];
    if (ids.length === 0) return new Map<number, { name: string; emoji: string | null; color: string | null }>();

    const categories = await this.prisma.category.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, emoji: true, color: true },
    });

    return new Map(categories.map((c) => [c.id, { name: c.name, emoji: c.emoji ?? null, color: c.color ?? null }]));
  }

  private mapGroupByToNamed(
    rows: Array<{ categoryId: number | null; _sum: { amount: any } }>,
    catMap: Map<number, { name: string; emoji: string | null; color: string | null }>,
  ): CategoryAmount[] {
    return rows
      .filter((r) => r.categoryId != null)
      .map((r) => {
        const id = r.categoryId as number;
        const amount = Number(r._sum.amount || 0);
        const meta = catMap.get(id);

        return {
          categoryId: id,
          name: meta?.name ?? "Sin nombre",
          emoji: meta?.emoji ?? null,
          color: meta?.color ?? null,
          amount,
        };
      })
      .filter((x) => x.amount !== 0);
  }

  // -----------------------------
  // Subcategory helpers
  // -----------------------------
  private async getSubcategoriesMap(subcategoryIds: number[]) {
    const ids = Array.from(new Set(subcategoryIds)).filter(Boolean) as number[];
    if (ids.length === 0)
      return new Map<number, { name: string; categoryId: number | null; emoji: string | null; color: string | null }>();

    // Ajusta el modelo/fields si tu Prisma usa otro nombre
    const subs = await this.prisma.subcategory.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, categoryId: true, emoji: true, color: true },
    });

    return new Map(
      subs.map((s) => [
        s.id,
        { name: s.name, categoryId: s.categoryId ?? null, emoji: s.emoji ?? null, color: s.color ?? null },
      ]),
    );
  }

  private mapGroupBySubToNamed(
    rows: Array<{ subcategoryId: number | null; _sum: { amount: any } }>,
    subMap: Map<number, { name: string; categoryId: number | null; emoji: string | null; color: string | null }>,
  ): SubcategoryAmount[] {
    return rows
      .filter((r) => r.subcategoryId != null)
      .map((r) => {
        const id = r.subcategoryId as number;
        const amount = Number(r._sum.amount || 0);
        const meta = subMap.get(id);

        return {
          subcategoryId: id,
          categoryId: meta?.categoryId ?? null,
          name: meta?.name ?? "Sin nombre",
          emoji: meta?.emoji ?? null,
          color: meta?.color ?? null,
          amount,
        };
      })
      .filter((x) => x.amount !== 0);
  }

  private buildCategoriesWithSubcategories(
    categories: CategoryAmount[],
    subcategories: SubcategoryAmount[],
  ): CategoryWithSubs[] {
    const subsByCat = new Map<number, SubcategoryAmount[]>();
    for (const s of subcategories) {
      if (!s.categoryId) continue;
      const arr = subsByCat.get(s.categoryId) || [];
      arr.push(s);
      subsByCat.set(s.categoryId, arr);
    }

    return categories
      .map((c) => {
        const subs = (subsByCat.get(c.categoryId) || [])
          .slice()
          .sort((a, b) => b.amount - a.amount)
          .map((s) => ({
            subcategoryId: s.subcategoryId,
            name: s.name,
            amount: s.amount,
            emoji: s.emoji,
            color: s.color,
          }));

        return {
          categoryId: c.categoryId,
          name: c.name,
          emoji: c.emoji,
          color: c.color,
          amount: c.amount,
          subcategories: subs,
        };
      })
      .sort((a, b) => b.amount - a.amount);
  }

  // ======================================================================
  // MONTHLY
  // ======================================================================
async getMonthlyReport(userId: number, opts: { month: string; walletId?: number }) {
  const { start, end } = monthRange(opts.month);
  const prev = prevMonth(opts.month);
  const { start: pStart, end: pEnd } = monthRange(prev);

  // ---- helper robusto para fechas ----
  const toIso = (d: any) => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString();

    // "YYYY-MM-DD HH:mm:ss.SSS" -> "YYYY-MM-DDTHH:mm:ss.SSSZ" (asumimos UTC)
    if (typeof d === "string" && d.includes(" ") && !d.includes("T")) {
      const isoGuess = d.replace(" ", "T") + "Z";
      const parsed = new Date(isoGuess);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }

    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString();
  };

  const baseWhere: any = {
    userId,
    active: true,
    excludeFromStats: false,
    recurrence: null,
    date: { gte: start, lt: end },
  };
  if (opts.walletId) baseWhere.walletId = opts.walletId;

  const prevWhere: any = {
    userId,
    active: true,
    excludeFromStats: false,
    recurrence: null,
    date: { gte: pStart, lt: pEnd },
  };
  if (opts.walletId) prevWhere.walletId = opts.walletId;

  // -----------------------------
  // Totales periodo actual + anterior
  // -----------------------------
  const [incomeAgg, expenseAgg, pIncomeAgg, pExpenseAgg] = await Promise.all([
    this.prisma.transaction.aggregate({
      where: { ...baseWhere, type: "income" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.aggregate({
      where: { ...baseWhere, type: "expense" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.aggregate({
      where: { ...prevWhere, type: "income" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.aggregate({
      where: { ...prevWhere, type: "expense" },
      _sum: { amount: true },
    }),
  ]);

  const income = Number(incomeAgg._sum.amount || 0);
  const expense = Number(expenseAgg._sum.amount || 0);
  const savings = income - expense;
  const savingsRate = income > 0 ? savings / income : 0;

  const pIncome = Number(pIncomeAgg._sum.amount || 0);
  const pExpense = Number(pExpenseAgg._sum.amount || 0);
  const pSavings = pIncome - pExpense;

  // -----------------------------
  // Breakdown por categoría
  // -----------------------------
  const [expenseByCategory, incomeByCategory] = await Promise.all([
    this.prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { ...baseWhere, type: "expense", categoryId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
    this.prisma.transaction.groupBy({
      by: ["categoryId"],
      where: { ...baseWhere, type: "income", categoryId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
  ]);

  const allCategoryIds = [
    ...expenseByCategory.map((x) => x.categoryId).filter(Boolean),
    ...incomeByCategory.map((x) => x.categoryId).filter(Boolean),
  ] as number[];

  const catMap = await this.getCategoriesMap(allCategoryIds);

  const expenseCategories = this.mapGroupByToNamed(expenseByCategory as any, catMap);
  const incomeCategories = this.mapGroupByToNamed(incomeByCategory as any, catMap);

  const topCategories = expenseCategories.slice(0, 5);

  // -----------------------------
  // Breakdown por subcategoría
  // -----------------------------
  const [expenseBySub, incomeBySub] = await Promise.all([
    this.prisma.transaction.groupBy({
      by: ["subcategoryId"],
      where: { ...baseWhere, type: "expense", subcategoryId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
    this.prisma.transaction.groupBy({
      by: ["subcategoryId"],
      where: { ...baseWhere, type: "income", subcategoryId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: "desc" } },
    }),
  ]);

  const allSubIds = [
    ...expenseBySub.map((x) => x.subcategoryId).filter(Boolean),
    ...incomeBySub.map((x) => x.subcategoryId).filter(Boolean),
  ] as number[];

  const subMap = await this.getSubcategoriesMap(allSubIds);

  const expenseSubcategories = this.mapGroupBySubToNamed(expenseBySub as any, subMap);
  const incomeSubcategories = this.mapGroupBySubToNamed(incomeBySub as any, subMap);

  const categoriesWithSubcategories = {
    expense: this.buildCategoriesWithSubcategories(expenseCategories, expenseSubcategories),
    income: this.buildCategoriesWithSubcategories(incomeCategories, incomeSubcategories),
  };

  // -----------------------------
  // Serie gasto diario
  // -----------------------------
  const monthExpenses = await this.prisma.transaction.findMany({
    where: { ...baseWhere, type: "expense" },
    select: { amount: true, date: true },
    orderBy: { date: "asc" },
  });

  const byDay = new Map<string, number>();
  for (const t of monthExpenses) {
    const d = new Date(t.date);
    const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
    byDay.set(key, (byDay.get(key) || 0) + Number(t.amount));
  }

  const dailyExpense = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, amount]) => ({ date, amount }));

  // -----------------------------
  // Patrimonio total (suma balances wallets)
  // -----------------------------
  const netWorthAgg = await this.prisma.wallet.aggregate({
    where: {
      userId,
      active: true,
      ...(opts.walletId ? { id: opts.walletId } : {}),
    },
    _sum: { balance: true }, // ajusta si tu campo se llama distinto
  });
  const netWorthTotal = Number(netWorthAgg._sum.balance || 0);

  // -----------------------------
  // Inversiones: operaciones del mes + assets
  // -----------------------------
  const invWhere: any = { userId, active: true, date: { gte: start, lt: end } };

  const invOps = await this.prisma.investmentOperation.findMany({
    where: invWhere,
    select: {
      id: true,
      assetId: true,
      type: true,
      date: true,
      amount: true,
      fee: true,
      transactionId: true,
      swapGroupId: true,
    },
    orderBy: { date: "desc" },
  });

  const assetIds = Array.from(new Set(invOps.map((o) => o.assetId).filter(Boolean))) as number[];

  const assets = assetIds.length
    ? await this.prisma.investmentAsset.findMany({
        where: { id: { in: assetIds }, userId, active: true },
        select: { id: true, name: true, type: true, identificator: true, currency: true },
      })
    : [];

  const assetMap = new Map(assets.map((a) => [a.id, a]));

  const investmentOperations = invOps.map((o) => {
    const a = assetMap.get(o.assetId);
    return {
      id: o.id,
      date: toIso(o.date) ?? "", // si prefieres, cambia a null y ajusta el tipo
      type: String(o.type),
      amount: Number(o.amount || 0),
      fee: Number(o.fee || 0),
      transactionId: o.transactionId ?? null,
      swapGroupId: o.swapGroupId ?? null,
      asset: {
        id: o.assetId,
        name: a?.name ?? `Asset #${o.assetId}`,
        type: a?.type ?? "unknown",
        identificator: a?.identificator ?? null,
        currency: a?.currency ?? null,
      },
    };
  });

  return {
    period: { type: "monthly", month: opts.month },
    walletId: opts.walletId ?? null,

    totals: { income, expense, savings, savingsRate },

    trends: {
      vsPreviousMonth: {
        income: this.delta(income, pIncome),
        expense: this.delta(expense, pExpense),
        savings: this.delta(savings, pSavings),
      },
      previousMonth: { month: prev, income: pIncome, expense: pExpense, savings: pSavings },
    },

    netWorthTotal,

    investments: {
      operations: investmentOperations,
    },

    topCategories,

    categoriesBreakdown: {
      expense: expenseCategories,
      income: incomeCategories,
    },

    subcategoriesBreakdown: {
      expense: expenseSubcategories,
      income: incomeSubcategories,
    },

    categoriesWithSubcategories,

    series: { dailyExpense },
  };
}

  // ======================================================================
  // YEARLY
  // ======================================================================
  async getYearlyReport(userId: number, opts: { year: string; walletId?: number }) {
    const { start, end } = yearRange(opts.year);
    const prev = prevYear(opts.year);
    const { start: pStart, end: pEnd } = yearRange(prev);

    const baseWhere: any = {
      userId,
      active: true,
      excludeFromStats: false, // si no existe, quita esta línea
      date: { gte: start, lt: end },
    };
    if (opts.walletId) baseWhere.walletId = opts.walletId;

    const prevWhere: any = {
      userId,
      active: true,
      excludeFromStats: false,
      date: { gte: pStart, lt: pEnd },
    };
    if (opts.walletId) prevWhere.walletId = opts.walletId;

    // Totales del año
    const [incomeAgg, expenseAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: "income" },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: "expense" },
        _sum: { amount: true },
      }),
    ]);

    const income = Number(incomeAgg._sum.amount || 0);
    const expense = Number(expenseAgg._sum.amount || 0);
    const savings = income - expense;
    const savingsRate = income > 0 ? savings / income : 0;

    // Totales año anterior
    const [pIncomeAgg, pExpenseAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...prevWhere, type: "income" },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...prevWhere, type: "expense" },
        _sum: { amount: true },
      }),
    ]);

    const pIncome = Number(pIncomeAgg._sum.amount || 0);
    const pExpense = Number(pExpenseAgg._sum.amount || 0);
    const pSavings = pIncome - pExpense;

    // Serie mensual (ingresos/gastos/ahorro por mes)
    const yearTx = await this.prisma.transaction.findMany({
      where: { ...baseWhere, type: { in: ["income", "expense"] } },
      select: { amount: true, date: true, type: true },
      orderBy: { date: "asc" },
    });

    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const t of yearTx) {
      const d = new Date(t.date);
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      const cur = byMonth.get(key) || { income: 0, expense: 0 };
      if (t.type === "income") cur.income += Number(t.amount);
      else cur.expense += Number(t.amount);
      byMonth.set(key, cur);
    }

    const months: string[] = [];
    for (let m = 1; m <= 12; m++) months.push(`${opts.year}-${String(m).padStart(2, "0")}`);

    const monthly = months.map((m) => {
      const v = byMonth.get(m) || { income: 0, expense: 0 };
      return { month: m, income: v.income, expense: v.expense, savings: v.income - v.expense };
    });

    // -----------------------------
    // Breakdown por categoría
    // -----------------------------
    const [expenseByCategory, incomeByCategory] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...baseWhere, type: "expense", categoryId: { not: null } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
      }),
      this.prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { ...baseWhere, type: "income", categoryId: { not: null } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
      }),
    ]);

    const allCategoryIds = [
      ...expenseByCategory.map((x) => x.categoryId).filter(Boolean),
      ...incomeByCategory.map((x) => x.categoryId).filter(Boolean),
    ] as number[];

    const catMap = await this.getCategoriesMap(allCategoryIds);

    const expenseCategories = this.mapGroupByToNamed(expenseByCategory as any, catMap);
    const incomeCategories = this.mapGroupByToNamed(incomeByCategory as any, catMap);

    const topCategories = expenseCategories.slice(0, 8);

    // -----------------------------
    // Breakdown por subcategoría (NUEVO)
    // -----------------------------
    const [expenseBySub, incomeBySub] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["subcategoryId"],
        where: { ...baseWhere, type: "expense", subcategoryId: { not: null } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
      }),
      this.prisma.transaction.groupBy({
        by: ["subcategoryId"],
        where: { ...baseWhere, type: "income", subcategoryId: { not: null } },
        _sum: { amount: true },
        orderBy: { _sum: { amount: "desc" } },
      }),
    ]);

    const allSubIds = [
      ...expenseBySub.map((x) => x.subcategoryId).filter(Boolean),
      ...incomeBySub.map((x) => x.subcategoryId).filter(Boolean),
    ] as number[];

    const subMap = await this.getSubcategoriesMap(allSubIds);

    const expenseSubcategories = this.mapGroupBySubToNamed(expenseBySub as any, subMap);
    const incomeSubcategories = this.mapGroupBySubToNamed(incomeBySub as any, subMap);

    const categoriesWithSubcategories = {
      expense: this.buildCategoriesWithSubcategories(expenseCategories, expenseSubcategories),
      income: this.buildCategoriesWithSubcategories(incomeCategories, incomeSubcategories),
    };

    return {
      period: { type: "yearly", year: opts.year },
      walletId: opts.walletId ?? null,

      totals: { income, expense, savings, savingsRate },

      trends: {
        vsPreviousYear: {
          income: this.delta(income, pIncome),
          expense: this.delta(expense, pExpense),
          savings: this.delta(savings, pSavings),
        },
        previousYear: { year: prev, income: pIncome, expense: pExpense, savings: pSavings },
      },

      topCategories,

      categoriesBreakdown: {
        expense: expenseCategories,
        income: incomeCategories,
      },

      // NUEVO
      subcategoriesBreakdown: {
        expense: expenseSubcategories,
        income: incomeSubcategories,
      },

      // NUEVO (opción 2 pro)
      categoriesWithSubcategories,

      series: { monthly },
    };
  }
}
