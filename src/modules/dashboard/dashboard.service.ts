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
