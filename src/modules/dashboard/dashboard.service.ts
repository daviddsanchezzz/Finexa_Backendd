import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FilterDashboardDto } from './dto/filter-dashboard.dto';
import { CurrencyService } from '../currency/currency.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private currency: CurrencyService) {}

  // Suma el balance de todas las carteras del usuario, convertidas a su
  // moneda base con el tipo ACTUAL (no histórico: es un patrimonio vivo).
  // No se persiste ningún "saldo en EUR" — se calcula al vuelo cada vez.
  async getNetWorth(userId: number) {
    const [wallets, user] = await Promise.all([
      this.prisma.wallet.findMany({
        where: { userId, active: true },
        select: { id: true, name: true, emoji: true, balance: true, currency: true },
        orderBy: { position: 'asc' },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } }),
    ]);
    const baseCurrency = user?.currency ?? 'EUR';

    const withBase = await Promise.all(
      wallets.map(async (w) => {
        if (w.currency === baseCurrency) return { ...w, balanceInBase: w.balance };
        const rate = await this.currency.getCurrentRate(w.currency, baseCurrency);
        return { ...w, balanceInBase: rate.times(w.balance).toNumber() };
      }),
    );

    return {
      total: withBase.reduce((sum, w) => sum + w.balanceInBase, 0),
      currency: baseCurrency,
      wallets: withBase,
    };
  }

  async getSummary(userId: number, filters: FilterDashboardDto) {
    const { startDate, endDate } = filters;

    const where = {
      userId,
      ...(startDate && endDate
        ? { date: { gte: new Date(startDate), lte: new Date(endDate) } }
        : {}),
    };

    const [income, expenses] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { ...where, type: 'income' },
        _sum: { amount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { ...where, type: 'expense' },
        _sum: { amount: true },
      }),
    ]);

    const totalIncome = income._sum.amount ?? 0;
    const totalExpenses = expenses._sum.amount ?? 0;

    return {
      totalIncome,
      totalExpenses,
      balance: totalIncome - totalExpenses,
      savingsRate: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0,
    };
  }

async getSummary2(userId: number, filters: FilterDashboardDto) {
  const { startDate, endDate, walletId } = filters;

  const baseWhere: any = {
    userId,
    active: { not: false },
    isRecurring: false,
    excludeFromStats: { not: true },
  };

  // ✅ Rango de fechas (incluye TODO el día endDate)
  if (startDate || endDate) {
    baseWhere.date = {};

    if (startDate) {
      baseWhere.date.gte = new Date(startDate);
    }

    if (endDate) {
      const toExclusive = new Date(endDate);
      // sumamos 1 día en UTC y usamos lt (exclusivo)
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);
      baseWhere.date.lt = toExclusive;
    }
  }

  // Income/Expense: se filtran por walletId (si existe)
  const incomeExpenseWhere = {
    ...baseWhere,
    ...(walletId ? { walletId } : {}),
  };

  // Inversión: transfers hacia wallet investment
  // Recomendado: si hay walletId, filtra por ORIGEN (fromWalletId)
  const investmentWhere = {
    ...baseWhere,
    type: "transfer",
    toWallet: { is: { kind: "investment", active: { not: false } } },
    investmentAssetId: { not: null },
    ...(walletId ? { fromWalletId: walletId } : {}),
  };

  // Prisma no puede sumar "baseAmount si no es null, si no amount" dentro de
  // un aggregate — se traen las filas y se suma en JS. El volumen de
  // transacciones de un usuario en un periodo es pequeño, así que el coste es
  // asumible; para una transacción EUR (baseAmount null) el resultado es
  // idéntico al aggregate anterior.
  const sumBaseOrAmount = (rows: { amount: number; baseAmount: any }[]) =>
    rows.reduce((sum, r) => sum + Math.abs(Number(r.baseAmount ?? r.amount ?? 0)), 0);

  const [incomeRows, expenseRows, investmentTransfers] = await Promise.all([
    this.prisma.transaction.findMany({ where: { ...incomeExpenseWhere, type: "income" }, select: { amount: true, baseAmount: true } }),
    this.prisma.transaction.findMany({ where: { ...incomeExpenseWhere, type: "expense" }, select: { amount: true, baseAmount: true } }),
    this.prisma.transaction.findMany({
      where: investmentWhere,
      select: {
        amount: true,
        investmentAsset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalIncome = sumBaseOrAmount(incomeRows);
  const totalExpenses = sumBaseOrAmount(expenseRows);

  const totalInvestment = investmentTransfers.reduce(
    (sum, t) => sum + Math.abs(Number(t.amount ?? 0)),
    0
  );

  const byAssetMap = new Map<number, { assetId: number; name: string; amount: number }>();

  for (const t of investmentTransfers) {
    const asset = t.investmentAsset;
    if (!asset) continue;

    const amt = Math.abs(Number(t.amount ?? 0));
    const prev = byAssetMap.get(asset.id);

    if (!prev) byAssetMap.set(asset.id, { assetId: asset.id, name: asset.name, amount: amt });
    else prev.amount += amt;
  }

  const investmentByAsset = Array.from(byAssetMap.values()).sort((a, b) => b.amount - a.amount);

  const balance = totalIncome - totalExpenses - totalInvestment;
  const savingsRate = totalIncome > 0 ? (balance / totalIncome) * 100 : 0;

  return {
    totalIncome,
    totalExpenses,
    totalInvestment,
    investmentByAsset,
    balance,
    savingsRate,
  };
}


  async getByCategory(userId: number, filters: FilterDashboardDto) {
    const { startDate, endDate, walletId } = filters;

    const where = {
      userId,
      type: 'expense',
      ...(walletId ? { walletId } : {}),
      ...(startDate && endDate
        ? { date: { gte: new Date(startDate), lte: new Date(endDate) } }
        : {}),
    };

    const rows = await this.prisma.transaction.findMany({
      where,
      select: { categoryId: true, amount: true, baseAmount: true },
    });

    const totalsByCategory = new Map<number, number>();
    for (const r of rows) {
      if (r.categoryId == null) continue;
      const prev = totalsByCategory.get(r.categoryId) ?? 0;
      totalsByCategory.set(r.categoryId, prev + Number(r.baseAmount ?? r.amount ?? 0));
    }

    const categoryIds = Array.from(totalsByCategory.keys());

    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, emoji: true , color:true},
    });

    return categoryIds.map(id => {
      const category = categories.find(c => c.id === id);
      return {
        id: category?.id,
        name: category?.name,
        emoji: category?.emoji,
        color: category?.color,
        total: totalsByCategory.get(id) ?? 0,
      };
    });
  }

  async getTrends(userId: number, filters: FilterDashboardDto) {
    const { startDate, endDate } = filters;

    const where = {
      userId,
      ...(startDate && endDate
        ? { date: { gte: new Date(startDate), lte: new Date(endDate) } }
        : {}),
    };

    const rows = await this.prisma.transaction.findMany({
      where,
      select: { type: true, amount: true, baseAmount: true },
    });

    const sumByType = (type: string) =>
      rows.filter(r => r.type === type).reduce((sum, r) => sum + Number(r.baseAmount ?? r.amount ?? 0), 0);

    return {
      income: sumByType('income'),
      expenses: sumByType('expense'),
      transactionsCount: rows.length,
    };
  }
}
