import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateBudgetDto } from './dto/create-budget.dto';
import { UpdateBudgetDto } from './dto/update-budget.dto';

import {
  addDays,
  addWeeks,
  addMonths,
  addYears,
  endOfDay,
} from 'date-fns';

@Injectable()
export class BudgetsService {
  constructor(private prisma: PrismaService) {}

  /* ------------------------------------------------------ */
  /*                     HELPERS DE FECHA                    */
  /* ------------------------------------------------------ */

  computePeriodEnd(period: string, start: Date) {
    switch (period) {
      case 'daily':
        return endOfDay(start);
      case 'weekly':
        return endOfDay(addDays(start, 6));
      case 'monthly':
        return endOfDay(addDays(addMonths(start, 1), -1));
      case 'yearly':
        return endOfDay(addDays(addYears(start, 1), -1));
      default:
        throw new Error(`Invalid budget period: ${period}`);
    }
  }

  nextPeriodDate(period: string, start: Date) {
    switch (period) {
      case 'daily':
        return addDays(start, 1);
      case 'weekly':
        return addWeeks(start, 1);
      case 'monthly':
        return addMonths(start, 1);
      case 'yearly':
        return addYears(start, 1);
      default:
        throw new Error(`Invalid budget period: ${period}`);
    }
  }

  /* ------------------------------------------------------ */
  /*                      CREATE BUDGET                      */
  /* ------------------------------------------------------ */

  async create(userId: number, dto: CreateBudgetDto) {
    return this.prisma.budget.create({
      data: {
        name: dto.name || null,
        period: dto.period,
        limit: dto.limit,
        startDate: new Date(dto.startDate),
        categoryId: dto.categoryId || null,
        walletId: dto.walletId || null,
        userId,
      },
    });
  }

  /* ------------------------------------------------------ */
  /*                       FIND ALL                          */
  /* ------------------------------------------------------ */

  async findAll(userId: number) {
    return this.prisma.budget.findMany({
      where: { userId, active: true },
      include: { category: true, wallet: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* ------------------------------------------------------ */
  /*                        FIND ONE                         */
  /* ------------------------------------------------------ */

  async findOne(userId: number, id: number) {
    const budget = await this.prisma.budget.findFirst({
      where: { id, userId, active: true },
      include: { category: true, wallet: true },
    });

    if (!budget) throw new NotFoundException('Budget not found');

    return budget;
  }

  /* ------------------------------------------------------ */
  /*                         UPDATE                          */
  /* ------------------------------------------------------ */

  async update(userId: number, id: number, dto: UpdateBudgetDto) {
    await this.findOne(userId, id);

    return this.prisma.budget.update({
      where: { id },
      data: {
        name: dto.name,
        period: dto.period,
        limit: dto.limit,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        categoryId: dto.categoryId ?? undefined,
        walletId: dto.walletId ?? undefined,
      },
    });
  }

  /* ------------------------------------------------------ */
  /*                         REMOVE                          */
  /* ------------------------------------------------------ */

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);

    return this.prisma.budget.update({
      where: { id },
      data: { active: false },
    });
  }

  /* ------------------------------------------------------ */
  /*                 GET PROGRESS (CICLO ACTUAL)             */
  /* ------------------------------------------------------ */

  async getProgress(userId: number, id: number) {
    const budget = await this.findOne(userId, id);

    const start = new Date(budget.startDate);
    const end = this.computePeriodEnd(budget.period, start);

    const totalSpent = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        active: true,
        type: 'expense',
        date: { gte: start, lte: end },
        ...(budget.categoryId && { categoryId: budget.categoryId }),
        ...(budget.walletId && { walletId: budget.walletId }),
      },
    });

    const spent = totalSpent._sum.amount || 0;

    return {
      ...budget,
      periodStart: start,
      periodEnd: end,
      spent,
      remaining: budget.limit - spent,
      percentage: Math.min((spent / budget.limit) * 100, 100),
    };
  }

  /* ------------------------------------------------------ */
  /*                  GET HISTORIAL COMPLETO                */
  /* ------------------------------------------------------ */

  async getHistory(userId: number, id: number) {
    await this.findOne(userId, id);

    return this.prisma.budgetPeriodHistory.findMany({
      where: { budgetId: id },
      orderBy: { from: 'desc' },
    });
  }

  /* ------------------------------------------------------ */
  /*                CERRAR UN PERIODO Y GENERAR HISTORY      */
  /* ------------------------------------------------------ */

  async closeCurrentPeriod(userId: number, id: number, forced = false) {
    const budget = await this.findOne(userId, id);

    const start = new Date(budget.startDate);
    const end = this.computePeriodEnd(budget.period, start);

    const now = new Date();

    // Si no se fuerza y el periodo aún no terminó → NO cerramos
    if (!forced && now < end) {
      return { closed: false, message: 'Periodo aún no ha terminado.' };
    }

    // Calcular gasto del periodo
    const totalSpent = await this.prisma.transaction.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        active: true,
        type: 'expense',
        date: { gte: start, lte: end },
        ...(budget.categoryId && { categoryId: budget.categoryId }),
        ...(budget.walletId && { walletId: budget.walletId }),
      },
    });

    const spent = totalSpent._sum.amount || 0;

    // Guardar historial
    const history = await this.prisma.budgetPeriodHistory.create({
      data: {
        budgetId: id,
        from: start,
        to: end,
        spent,
      },
    });

    // Avanzar startDate al siguiente ciclo
    const nextStart = this.nextPeriodDate(budget.period, start);

    await this.prisma.budget.update({
      where: { id },
      data: { startDate: nextStart },
    });

    return {
      closed: true,
      history,
      nextStartDate: nextStart,
    };
  }

  /* ------------------------------------------------------ */
  /*          CIERRE AUTOMÁTICO (llamado por el CRON)        */
  /* ------------------------------------------------------ */

  async processAutomaticClosures() {
    const budgets = await this.prisma.budget.findMany({
      where: { active: true },
    });

    for (const b of budgets) {
      await this.closeCurrentPeriod(b.userId, b.id, false);
    }

    return { processed: budgets.length };
  }
}
