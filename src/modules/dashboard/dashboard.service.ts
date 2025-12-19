import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FilterDashboardDto } from './dto/filter-dashboard.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

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
    ...(startDate && endDate
      ? { date: { gte: new Date(startDate), lte: new Date(endDate) } }
      : {}),
  };

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

  const [incomeAgg, expenseAgg, investmentTransfers] = await Promise.all([
    this.prisma.transaction.aggregate({
      where: { ...incomeExpenseWhere, type: "income" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.aggregate({
      where: { ...incomeExpenseWhere, type: "expense" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.findMany({
      where: investmentWhere,
      select: {
        amount: true,
        investmentAsset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalIncome = Math.abs(Number(incomeAgg._sum.amount ?? 0));
  const totalExpenses = Math.abs(Number(expenseAgg._sum.amount ?? 0));

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

    const results = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where,
      _sum: { amount: true },
    });

    const categoryIds = results
      .map(r => r.categoryId)
      .filter((id): id is number => id !== null && id !== undefined);
    
    const categories = await this.prisma.category.findMany({
      where: { id: { in: categoryIds } },
      select: { id: true, name: true, emoji: true , color:true},
    });
    
    return results.map(r => {
      const category = categories.find(c => c.id === r.categoryId);
      return {
        id: category?.id,
        name: category?.name,
        emoji: category?.emoji,
        color: category?.color,
        total: r._sum.amount ?? 0,
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

    const results = await this.prisma.transaction.groupBy({
      by: ['type'],
      _sum: { amount: true },
      _count: { id: true },
      where,
    });

    return {
      income: results.find(r => r.type === 'income')?._sum.amount ?? 0,
      expenses: results.find(r => r.type === 'expense')?._sum.amount ?? 0,
      transactionsCount: results.reduce((acc, r) => acc + r._count.id, 0),
    };
  }
}
