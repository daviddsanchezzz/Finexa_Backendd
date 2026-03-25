import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { AttachProjectTransactionsDto } from './dto/attach-project-transactions.dto';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import {
  CreateProjectManualEntryDto,
  UpdateProjectManualEntryDto,
} from './dto/project-manual-entry.dto';
import {
  CreateProjectProfitDistributionDto,
  UpdateProjectProfitDistributionDto,
} from './dto/project-profit-distribution.dto';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  private toDate(value: string, field: string): Date {
    const parsed = new Date(value);
    if (isNaN(parsed.getTime())) {
      throw new BadRequestException(`${field} no es una fecha valida`);
    }
    return parsed;
  }

  private async assertOwnership(userId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });

    if (!project) {
      throw new ForbiddenException('No tienes acceso a este proyecto');
    }

    return true;
  }

  private async buildFinancialsMap(userId: number, projectIds: number[]) {
    if (!projectIds.length) return new Map<number, any>();

    const [txGrouped, manualGrouped] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['projectId', 'type'],
        where: {
          userId,
          active: true,
          projectId: { in: projectIds },
          type: { in: ['income', 'expense'] },
        },
        _sum: { amount: true },
      }),
      this.prisma.projectManualEntry.groupBy({
        by: ['projectId', 'type'],
        where: {
          projectId: { in: projectIds },
        },
        _sum: { amount: true },
      }),
    ]);

    const map = new Map<number, any>();

    for (const projectId of projectIds) {
      map.set(projectId, {
        transactionsIncome: 0,
        transactionsExpense: 0,
        manualIncome: 0,
        manualExpense: 0,
        totalIncome: 0,
        totalExpense: 0,
        balance: 0,
      });
    }

    for (const row of txGrouped) {
      if (!row.projectId) continue;
      const data = map.get(row.projectId);
      const value = Number(row._sum.amount || 0);
      if (row.type === 'income') data.transactionsIncome = value;
      if (row.type === 'expense') data.transactionsExpense = value;
    }

    for (const row of manualGrouped) {
      const data = map.get(row.projectId);
      if (!data) continue;
      const value = Number(row._sum.amount || 0);
      if (row.type === 'income') data.manualIncome = value;
      if (row.type === 'expense') data.manualExpense = value;
    }

    for (const [, data] of map) {
      data.totalIncome = data.transactionsIncome + data.manualIncome;
      data.totalExpense = data.transactionsExpense + data.manualExpense;
      data.balance = data.totalIncome - data.totalExpense;
    }

    return map;
  }

  private validateDistributionLines(
    totalAmount: number,
    lines: { partnerName: string; amount: number }[],
  ) {
    if (!lines?.length) {
      throw new BadRequestException('Debes añadir al menos un socio en el reparto');
    }

    const sum = lines.reduce((acc, line) => acc + Number(line.amount || 0), 0);
    const roundedTotal = Math.round(totalAmount * 100);
    const roundedSum = Math.round(sum * 100);

    if (roundedTotal !== roundedSum) {
      throw new BadRequestException(
        `La suma de líneas (${sum.toFixed(2)}) debe coincidir con el total (${totalAmount.toFixed(2)})`,
      );
    }
  }

  async create(userId: number, dto: CreateProjectDto) {
    const startDate = this.toDate(dto.startDate, 'startDate');
    const endDate = dto.endDate ? this.toDate(dto.endDate, 'endDate') : null;

    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate no puede ser anterior a startDate');
    }

    const project = await this.prisma.project.create({
      data: {
        userId,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        type: dto.type?.trim() || null,
        status: dto.status,
        startDate,
        endDate,
        notes: dto.notes?.trim() || null,
      },
    });

    return {
      ...project,
      financials: {
        transactionsIncome: 0,
        transactionsExpense: 0,
        manualIncome: 0,
        manualExpense: 0,
        totalIncome: 0,
        totalExpense: 0,
        balance: 0,
      },
    };
  }

  async findAll(userId: number) {
    const projects = await this.prisma.project.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    const financialsMap = await this.buildFinancialsMap(
      userId,
      projects.map((p) => p.id),
    );

    return projects.map((project) => ({
      ...project,
      financials: financialsMap.get(project.id),
    }));
  }

  async findOne(userId: number, projectId: number) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      include: {
        transactions: {
          where: { active: true },
          include: {
            category: true,
            subcategory: true,
            wallet: true,
            fromWallet: true,
            toWallet: true,
          },
          orderBy: { date: 'desc' },
        },
        manualEntries: {
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        },
        profitDistributions: {
          include: {
            lines: true,
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        },
      },
    });

    if (!project) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    const financialsMap = await this.buildFinancialsMap(userId, [projectId]);

    const baseFinancials = financialsMap.get(projectId);
    const totalDistributed = project.profitDistributions.reduce(
      (acc, item) => acc + Number(item.totalAmount || 0),
      0,
    );
    const retainedProfit = Number(baseFinancials.balance || 0) - totalDistributed;

    return {
      ...project,
      financials: {
        ...baseFinancials,
        totalDistributed,
        retainedProfit,
      },
    };
  }

  async update(userId: number, projectId: number, dto: UpdateProjectDto) {
    const existing = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
    });

    if (!existing) {
      throw new NotFoundException('Proyecto no encontrado');
    }

    const nextStartDate = dto.startDate
      ? this.toDate(dto.startDate, 'startDate')
      : existing.startDate;
    const nextEndDate = dto.endDate
      ? this.toDate(dto.endDate, 'endDate')
      : dto.endDate === null
      ? null
      : existing.endDate;

    if (nextEndDate && nextEndDate < nextStartDate) {
      throw new BadRequestException('endDate no puede ser anterior a startDate');
    }

    return this.prisma.project.update({
      where: { id: projectId },
      data: {
        name: dto.name?.trim(),
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
        type: dto.type !== undefined ? dto.type?.trim() || null : undefined,
        status: dto.status,
        startDate: dto.startDate ? nextStartDate : undefined,
        endDate:
          dto.endDate !== undefined
            ? dto.endDate
              ? nextEndDate
              : null
            : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
      },
    });
  }

  async remove(userId: number, projectId: number) {
    await this.assertOwnership(userId, projectId);

    await this.prisma.transaction.updateMany({
      where: { userId, projectId },
      data: { projectId: null },
    });

    await this.prisma.project.delete({ where: { id: projectId } });

    return { success: true };
  }

  async attachTransactions(
    userId: number,
    projectId: number,
    dto: AttachProjectTransactionsDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const result = await this.prisma.transaction.updateMany({
      where: {
        id: { in: dto.transactionIds },
        userId,
        active: true,
        type: { in: ['income', 'expense'] },
      },
      data: { projectId },
    });

    return { success: true, updated: result.count };
  }

  async detachTransactions(
    userId: number,
    projectId: number,
    dto: AttachProjectTransactionsDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const result = await this.prisma.transaction.updateMany({
      where: {
        id: { in: dto.transactionIds },
        userId,
        active: true,
        projectId,
      },
      data: { projectId: null },
    });

    return { success: true, updated: result.count };
  }

  async createManualEntry(
    userId: number,
    projectId: number,
    dto: CreateProjectManualEntryDto,
  ) {
    await this.assertOwnership(userId, projectId);

    return this.prisma.projectManualEntry.create({
      data: {
        projectId,
        type: dto.type,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        amount: dto.amount,
        date: this.toDate(dto.date, 'date'),
        category: dto.category?.trim() || null,
        notes: dto.notes?.trim() || null,
      },
    });
  }

  async updateManualEntry(
    userId: number,
    projectId: number,
    entryId: number,
    dto: UpdateProjectManualEntryDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const existing = await this.prisma.projectManualEntry.findFirst({
      where: { id: entryId, projectId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Movimiento manual no encontrado');
    }

    return this.prisma.projectManualEntry.update({
      where: { id: entryId },
      data: {
        type: dto.type,
        title: dto.title?.trim(),
        description:
          dto.description !== undefined ? dto.description?.trim() || null : undefined,
        amount: dto.amount,
        date: dto.date ? this.toDate(dto.date, 'date') : undefined,
        category: dto.category !== undefined ? dto.category?.trim() || null : undefined,
        notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
      },
    });
  }

  async removeManualEntry(userId: number, projectId: number, entryId: number) {
    await this.assertOwnership(userId, projectId);

    const existing = await this.prisma.projectManualEntry.findFirst({
      where: { id: entryId, projectId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Movimiento manual no encontrado');
    }

    await this.prisma.projectManualEntry.delete({ where: { id: entryId } });

    return { success: true };
  }

  async createProfitDistribution(
    userId: number,
    projectId: number,
    dto: CreateProjectProfitDistributionDto,
  ) {
    await this.assertOwnership(userId, projectId);
    this.validateDistributionLines(dto.totalAmount, dto.lines);

    const totalAmount = Number(dto.totalAmount);
    const linesData = dto.lines.map((line) => {
      const amount = Number(line.amount);
      const percentage = totalAmount > 0 ? Number(((amount / totalAmount) * 100).toFixed(4)) : null;
      return {
        partnerName: line.partnerName.trim(),
        amount,
        percentage,
        notes: line.notes?.trim() || null,
      };
    });

    return this.prisma.projectProfitDistribution.create({
      data: {
        projectId,
        title: dto.title?.trim() || null,
        totalAmount,
        date: this.toDate(dto.date, 'date'),
        notes: dto.notes?.trim() || null,
        lines: {
          create: linesData,
        },
      },
      include: {
        lines: true,
      },
    });
  }

  async updateProfitDistribution(
    userId: number,
    projectId: number,
    distributionId: number,
    dto: UpdateProjectProfitDistributionDto,
  ) {
    await this.assertOwnership(userId, projectId);

    const existing = await this.prisma.projectProfitDistribution.findFirst({
      where: { id: distributionId, projectId },
      include: { lines: true },
    });

    if (!existing) {
      throw new NotFoundException('Reparto de beneficios no encontrado');
    }

    const nextTotalAmount =
      dto.totalAmount !== undefined ? Number(dto.totalAmount) : Number(existing.totalAmount);
    const nextLines =
      dto.lines !== undefined
        ? dto.lines
        : existing.lines.map((line) => ({
            partnerName: line.partnerName,
            amount: Number(line.amount),
            notes: line.notes || undefined,
          }));

    this.validateDistributionLines(nextTotalAmount, nextLines);

    const linesData = nextLines.map((line) => {
      const amount = Number(line.amount);
      const percentage = nextTotalAmount > 0 ? Number(((amount / nextTotalAmount) * 100).toFixed(4)) : null;
      return {
        partnerName: line.partnerName.trim(),
        amount,
        percentage,
        notes: line.notes?.trim() || null,
      };
    });

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.projectProfitDistribution.update({
        where: { id: distributionId },
        data: {
          title: dto.title !== undefined ? dto.title?.trim() || null : undefined,
          totalAmount: dto.totalAmount !== undefined ? nextTotalAmount : undefined,
          date: dto.date ? this.toDate(dto.date, 'date') : undefined,
          notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
        },
      });

      if (dto.lines !== undefined) {
        await tx.projectProfitDistributionLine.deleteMany({
          where: { distributionId },
        });

        await tx.projectProfitDistributionLine.createMany({
          data: linesData.map((line) => ({
            distributionId,
            partnerName: line.partnerName,
            amount: line.amount,
            percentage: line.percentage,
            notes: line.notes,
          })),
        });
      }

      return tx.projectProfitDistribution.findUnique({
        where: { id: updated.id },
        include: { lines: true },
      });
    });
  }

  async removeProfitDistribution(
    userId: number,
    projectId: number,
    distributionId: number,
  ) {
    await this.assertOwnership(userId, projectId);

    const existing = await this.prisma.projectProfitDistribution.findFirst({
      where: { id: distributionId, projectId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Reparto de beneficios no encontrado');
    }

    await this.prisma.projectProfitDistribution.delete({
      where: { id: distributionId },
    });

    return { success: true };
  }
}

