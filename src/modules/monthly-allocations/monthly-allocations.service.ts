import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateAllocationItemDto } from './dto/create-item.dto';
import { UpdateAllocationItemDto } from './dto/update-item.dto';

const pct = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

@Injectable()
export class AllocationPlanService {
  constructor(private prisma: PrismaService) {}

  private toNum(x: any) {
    return Number(x);
  }

  private computeSummary(income: number, items: Array<{ category: string; amount: any }>) {
    const totals = { expense: 0, investment: 0, savings: 0 };

    for (const it of items) {
      const a = this.toNum(it.amount);
      if (it.category === 'expense') totals.expense += a;
      if (it.category === 'investment') totals.investment += a;
      if (it.category === 'savings') totals.savings += a;
    }

    const allocated = totals.expense + totals.investment + totals.savings;
    const remaining = income - allocated;

    return {
      totals,
      allocated,
      remaining,
      percentages: {
        expense: pct(totals.expense, income),
        investment: pct(totals.investment, income),
        savings: pct(totals.savings, income),
        allocated: pct(allocated, income),
      },
    };
  }

  private async getOrCreatePlan(userId: number) {
    return this.prisma.allocationPlan.upsert({
      where: { userId },
      update: {},
      create: {
        userId,
        income: 0,
        currency: 'EUR',
      },
      select: { id: true, userId: true, income: true, currency: true },
    });
  }

  async get(userId: number) {
    const plan = await this.prisma.allocationPlan.findUnique({
      where: { userId },
      include: {
        items: {
          orderBy: [{ order: 'asc' }, { id: 'desc' }],
          select: { id: true, category: true, name: true, amount: true, order: true, createdAt: true },
        },
      },
    });

    if (!plan) {
      const created = await this.getOrCreatePlan(userId);
      const summary = this.computeSummary(0, []);
      return { ...created, income: Number(created.income), items: [], summary };
    }

    const income = Number(plan.income);
    const summary = this.computeSummary(income, plan.items);

    return {
      id: plan.id,
      userId: plan.userId,
      income,
      currency: plan.currency,
      items: plan.items.map((i) => ({
        ...i,
        amount: Number(i.amount),
        percentOfIncome: pct(Number(i.amount), income),
      })),
      summary,
    };
  }

  async updatePlan(userId: number, dto: UpdateAllocationPlanDto) {
    const plan = await this.getOrCreatePlan(userId);

    await this.prisma.allocationPlan.update({
      where: { id: plan.id },
      data: {
        income: dto.income,
        currency: 'EUR', // fijo por ahora
      },
    });

    return this.get(userId);
  }

  async addItem(userId: number, dto: CreateAllocationItemDto) {
    const plan = await this.getOrCreatePlan(userId);

    await this.prisma.allocationItem.create({
      data: {
        planId: plan.id,
        category: dto.category as any,
        name: dto.name,
        amount: dto.amount,
        order: dto.order ?? 0,
      },
    });

    return this.get(userId);
  }

  async updateItem(userId: number, itemId: number, dto: UpdateAllocationItemDto) {
    const item = await this.prisma.allocationItem.findUnique({
      where: { id: itemId },
      select: { id: true, plan: { select: { userId: true } } },
    });

    if (!item || item.plan.userId !== userId) throw new NotFoundException('Item not found');

    await this.prisma.allocationItem.update({
      where: { id: itemId },
      data: {
        category: dto.category ? (dto.category as any) : undefined,
        name: dto.name,
        amount: dto.amount,
        order: dto.order,
      },
    });

    return this.get(userId);
  }

  async deleteItem(userId: number, itemId: number) {
    const item = await this.prisma.allocationItem.findUnique({
      where: { id: itemId },
      select: { id: true, plan: { select: { userId: true } } },
    });

    if (!item || item.plan.userId !== userId) throw new NotFoundException('Item not found');

    await this.prisma.allocationItem.delete({ where: { id: itemId } });

    return this.get(userId);
  }
}
