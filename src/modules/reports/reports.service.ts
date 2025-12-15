import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';

function monthRange(month: string) {
  const m = month?.trim();
  if (!/^\d{4}-\d{2}$/.test(m)) throw new BadRequestException('month debe ser YYYY-MM');
  const [y, mm] = m.split('-').map(Number);
  const start = new Date(Date.UTC(y, mm - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(y, mm, 1, 0, 0, 0));
  return { start, end };
}

function prevMonth(month: string) {
  const [y, mm] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, mm - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const y2 = d.getUTCFullYear();
  const m2 = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y2}-${m2}`;
}

function yearRange(year: string) {
  const y = year?.trim();
  if (!/^\d{4}$/.test(y)) throw new BadRequestException('year debe ser YYYY');
  const Y = Number(y);
  const start = new Date(Date.UTC(Y, 0, 1, 0, 0, 0));
  const end = new Date(Date.UTC(Y + 1, 0, 1, 0, 0, 0));
  return { start, end };
}

function prevYear(year: string) {
  const Y = Number(year);
  return String(Y - 1);
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getMonthlyReport(userId: number, opts: { month: string; walletId?: number }) {
    const { start, end } = monthRange(opts.month);
    const prev = prevMonth(opts.month);
    const { start: pStart, end: pEnd } = monthRange(prev);

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

    const [incomeAgg, expenseAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: 'income' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: 'expense' },
        _sum: { amount: true },
      }),
    ]);

    const income = Number(incomeAgg._sum.amount || 0);
    const expense = Number(expenseAgg._sum.amount || 0);
    const savings = income - expense;
    const savingsRate = income > 0 ? savings / income : 0;

    const [pIncomeAgg, pExpenseAgg] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...prevWhere, type: 'income' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...prevWhere, type: 'expense' },
        _sum: { amount: true },
      }),
    ]);

    const pIncome = Number(pIncomeAgg._sum.amount || 0);
    const pExpense = Number(pExpenseAgg._sum.amount || 0);
    const pSavings = pIncome - pExpense;

    const delta = (cur: number, prev: number) => ({
      value: cur - prev,
      pct: prev !== 0 ? (cur - prev) / prev : null,
    });

    const topByCategory = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...baseWhere, type: 'expense', categoryId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 5,
    });

    const categoryIds = topByCategory.map((x) => x.categoryId).filter(Boolean) as number[];
    const categories = categoryIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : [];
    const catName = new Map(categories.map((c) => [c.id, c.name]));

    const topCategories = topByCategory.map((x) => ({
      categoryId: x.categoryId,
      name: x.categoryId ? catName.get(x.categoryId) ?? 'Sin nombre' : 'Sin categoría',
      amount: Number(x._sum.amount || 0),
    }));

    const monthExpenses = await this.prisma.transaction.findMany({
      where: { ...baseWhere, type: 'expense' },
      select: { amount: true, date: true },
      orderBy: { date: 'asc' },
    });

    const byDay = new Map<string, number>();
    for (const t of monthExpenses) {
      const d = new Date(t.date);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
      byDay.set(key, (byDay.get(key) || 0) + Number(t.amount));
    }

    const dailyExpense = [...byDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, amount]) => ({ date, amount }));

    return {
      period: { type: 'monthly', month: opts.month },
      walletId: opts.walletId ?? null,
      totals: { income, expense, savings, savingsRate },
      trends: {
        vsPreviousMonth: {
          income: delta(income, pIncome),
          expense: delta(expense, pExpense),
          savings: delta(savings, pSavings),
        },
        previousMonth: { month: prev, income: pIncome, expense: pExpense, savings: pSavings },
      },
      topCategories,
      series: { dailyExpense },
    };
  }

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
        where: { ...baseWhere, type: 'income' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...baseWhere, type: 'expense' },
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
        where: { ...prevWhere, type: 'income' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...prevWhere, type: 'expense' },
        _sum: { amount: true },
      }),
    ]);
    const pIncome = Number(pIncomeAgg._sum.amount || 0);
    const pExpense = Number(pExpenseAgg._sum.amount || 0);
    const pSavings = pIncome - pExpense;

    const delta = (cur: number, prev: number) => ({
      value: cur - prev,
      pct: prev !== 0 ? (cur - prev) / prev : null,
    });

    // Serie mensual (ingresos/gastos/ahorro por mes)
    const yearTx = await this.prisma.transaction.findMany({
      where: { ...baseWhere, type: { in: ['income', 'expense'] } },
      select: { amount: true, date: true, type: true },
      orderBy: { date: 'asc' },
    });

    const byMonth = new Map<string, { income: number; expense: number }>();
    for (const t of yearTx) {
      const d = new Date(t.date);
      const key = d.toISOString().slice(0, 7); // YYYY-MM
      const cur = byMonth.get(key) || { income: 0, expense: 0 };
      if (t.type === 'income') cur.income += Number(t.amount);
      else cur.expense += Number(t.amount);
      byMonth.set(key, cur);
    }

    // Asegura que salgan los 12 meses aunque no haya tx
    const months: string[] = [];
    for (let m = 1; m <= 12; m++) months.push(`${opts.year}-${String(m).padStart(2, '0')}`);

    const monthly = months.map((m) => {
      const v = byMonth.get(m) || { income: 0, expense: 0 };
      return { month: m, income: v.income, expense: v.expense, savings: v.income - v.expense };
    });

    // Top categorías del año (gasto)
    const topByCategory = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { ...baseWhere, type: 'expense', categoryId: { not: null } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 8,
    });

    const categoryIds = topByCategory.map((x) => x.categoryId).filter(Boolean) as number[];
    const categories = categoryIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true },
        })
      : [];
    const catName = new Map(categories.map((c) => [c.id, c.name]));

    const topCategories = topByCategory.map((x) => ({
      categoryId: x.categoryId,
      name: x.categoryId ? catName.get(x.categoryId) ?? 'Sin nombre' : 'Sin categoría',
      amount: Number(x._sum.amount || 0),
    }));

    return {
      period: { type: 'yearly', year: opts.year },
      walletId: opts.walletId ?? null,
      totals: { income, expense, savings, savingsRate },
      trends: {
        vsPreviousYear: {
          income: delta(income, pIncome),
          expense: delta(expense, pExpense),
          savings: delta(savings, pSavings),
        },
        previousYear: { year: prev, income: pIncome, expense: pExpense, savings: pSavings },
      },
      topCategories,
      series: { monthly },
    };
  }
}
