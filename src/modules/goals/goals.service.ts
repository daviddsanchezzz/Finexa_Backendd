import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { GoalStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AllocationDto, CreateGoalDto, ManualEntryDto, UpdateGoalDto } from './dto/goal.dto';
import { getGoalCurrentAmount, getGoalMetrics, getGoalSummary, getWalletAvailability, sumMoney } from './goal-calculations';
import { withGoalLock } from './goal-reservations';

const goalInclude = {
  linkedWallet: true,
  allocations: { include: { wallet: true } },
  manualEntries: { orderBy: [{ date: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.GoalInclude;
type LoadedGoal = Prisma.GoalGetPayload<{ include: typeof goalInclude }>;

@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  private async owned(tx: Prisma.TransactionClient, userId: number, id: number) {
    const goal = await tx.goal.findFirst({ where: { id, userId }, include: goalInclude });
    if (!goal) throw new NotFoundException('Objetivo no encontrado.');
    return goal;
  }

  private editable(goal: LoadedGoal) {
    if (goal.status === 'ARCHIVED') throw new BadRequestException('El objetivo está archivado y solo se puede consultar o eliminar.');
  }

  private serialize(goal: LoadedGoal, wallets: Awaited<ReturnType<GoalsService['wallets']>>) {
    return {
      ...goal,
      archivedAmount: goal.archivedAmount == null ? null : Number(goal.archivedAmount),
      ...getGoalMetrics(goal.targetAmount, getGoalCurrentAmount(goal), goal.targetDate),
      linkedWallet: goal.linkedWallet ? { id: goal.linkedWallet.id, name: goal.linkedWallet.name, emoji: goal.linkedWallet.emoji, currency: goal.linkedWallet.currency, balance: goal.linkedWallet.balance } : null,
      allocations: goal.allocations.map((a) => ({
        id: a.id, goalId: a.goalId, walletId: a.walletId, amount: Number(a.amount),
        createdAt: a.createdAt, updatedAt: a.updatedAt,
        wallet: { id: a.wallet.id, name: a.wallet.name, emoji: a.wallet.emoji, currency: a.wallet.currency, balance: a.wallet.balance },
        overAllocated: goal.status === 'ARCHIVED' ? 0 : wallets.find((w) => w.id === a.walletId)?.overAllocated ?? 0,
      })),
      manualEntries: goal.manualEntries.map((e) => ({ ...e, amount: Number(e.amount) })),
    };
  }

  async wallets(userId: number, tx: Prisma.TransactionClient = this.prisma) {
    const wallets = await tx.wallet.findMany({
      where: { userId, active: true }, orderBy: { position: 'asc' },
      include: {
        goalAllocations: { where: { goal: { userId, status: { not: 'ARCHIVED' } } } },
        linkedGoals: { where: { userId, status: { not: 'ARCHIVED' }, trackingMode: 'WALLET_BALANCE' }, select: { id: true, name: true } },
      },
    });
    return wallets.map((w) => ({
      id: w.id, name: w.name, emoji: w.emoji, currency: w.currency,
      ...getWalletAvailability(w.balance, w.goalAllocations.map((a) => a.amount), w.linkedGoals.length > 0),
      linkedGoal: w.linkedGoals[0] ?? null,
    }));
  }

  async findAll(userId: number) {
    return this.prisma.$transaction(async (tx) => {
      const goals = await tx.goal.findMany({ where: { userId }, include: goalInclude, orderBy: { createdAt: 'desc' } });
      const wallets = await this.wallets(userId, tx);
      const items = goals.map((g) => this.serialize(g, wallets));
      return { goals: items, summaries: getGoalSummary(items) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  async findOne(userId: number, id: number) {
    return this.prisma.$transaction(async (tx) => {
      const goal = await this.owned(tx, userId, id);
      return this.serialize(goal, await this.wallets(userId, tx));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  private async validateAllocations(tx: Prisma.TransactionClient, userId: number, goalId: number, currency: string, allocations: AllocationDto[]) {
    if (new Set(allocations.map((a) => a.walletId)).size !== allocations.length) throw new BadRequestException('Hay carteras duplicadas.');
    const wallets = await this.wallets(userId, tx);
    const existing = await tx.goalAllocation.findMany({ where: { goalId } });
    for (const a of allocations) {
      const w = wallets.find((wallet) => wallet.id === a.walletId);
      if (!w) throw new BadRequestException('La cartera no existe o no te pertenece.');
      if (w.currency !== currency) throw new BadRequestException('La cartera y el objetivo deben usar la misma moneda.');
      if (w.fullyLinked && a.amount > 0) throw new BadRequestException('Esta cartera ya está vinculada por completo a otro objetivo.');
      const previous = Number(existing.find((e) => e.walletId === a.walletId)?.amount ?? 0);
      const additional = new Prisma.Decimal(a.amount).minus(previous).toNumber();
      // A balance drop must not trap users: allow reducing an existing reserve
      // even when the wallet remains overallocated after that reduction.
      if (additional > 0 && new Prisma.Decimal(additional).greaterThan(w.availableToAllocate)) {
        throw new BadRequestException(`Saldo insuficiente para asignar dinero de ${w.name}. Disponible: ${w.availableToAllocate.toFixed(2).replace('.', ',')} ${currency}.`);
      }
    }
  }

  async create(userId: number, dto: CreateGoalDto) {
    if (!dto.name.trim()) throw new BadRequestException('El nombre es obligatorio.');
    if (dto.trackingMode !== 'MANUAL' && dto.initialAmount != null) throw new BadRequestException('La cantidad inicial solo corresponde al progreso manual.');
    if (dto.trackingMode !== 'ALLOCATIONS' && dto.allocations?.length) throw new BadRequestException('Este método no utiliza asignaciones.');
    if (dto.trackingMode !== 'WALLET_BALANCE' && dto.linkedWalletId != null) throw new BadRequestException('Este método no vincula una cartera.');
    const goal = await withGoalLock(this.prisma, userId, async (tx) => {
      if (dto.trackingMode === 'WALLET_BALANCE') {
        const wallet = (await this.wallets(userId, tx)).find((w) => w.id === dto.linkedWalletId);
        if (!wallet || wallet.currency !== dto.currency) throw new BadRequestException('Selecciona una cartera propia con la misma moneda.');
        if (wallet.fullyLinked || wallet.allocatedAmount > 0) throw new BadRequestException('La cartera ya tiene dinero reservado para otros objetivos.');
      }
      const goal = await tx.goal.create({ data: {
        userId, name: dto.name.trim(), description: dto.description?.trim() || null,
        icon: dto.icon || null, color: dto.color || null, targetAmount: dto.targetAmount,
        currency: dto.currency, trackingMode: dto.trackingMode, linkedWalletId: dto.linkedWalletId ?? null,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        startDate: dto.startDate ? new Date(dto.startDate) : new Date(),
      } });
      if (dto.trackingMode === 'ALLOCATIONS') {
        await this.validateAllocations(tx, userId, goal.id, dto.currency, dto.allocations ?? []);
        await tx.goalAllocation.createMany({ data: (dto.allocations ?? []).filter((a) => a.amount > 0).map((a) => ({ ...a, goalId: goal.id })) });
      }
      if (dto.trackingMode === 'MANUAL' && dto.initialAmount) {
        await tx.goalManualEntry.create({ data: { goalId: goal.id, amount: dto.initialAmount, date: goal.startDate, note: 'Cantidad inicial' } });
      }
      return goal;
    });
    return this.findOne(userId, goal.id);
  }

  async update(userId: number, id: number, dto: UpdateGoalDto) {
    if (dto.name != null && !dto.name.trim()) throw new BadRequestException('El nombre es obligatorio.');
    // PartialType accepts null; required stored fields must never be cleared.
    if (dto.name === null || dto.targetAmount === null || dto.startDate === null) throw new BadRequestException('Los campos obligatorios no pueden quedar vacíos.');
    await withGoalLock(this.prisma, userId, async (tx) => {
      this.editable(await this.owned(tx, userId, id));
      await tx.goal.update({ where: { id }, data: {
        ...dto, name: dto.name?.trim(),
        ...(dto.targetDate !== undefined ? { targetDate: dto.targetDate ? new Date(dto.targetDate) : null } : {}),
        ...(dto.startDate ? { startDate: new Date(dto.startDate) } : {}),
      } });
    });
    return this.findOne(userId, id);
  }

  async setAllocations(userId: number, id: number, allocations: AllocationDto[]) {
    await withGoalLock(this.prisma, userId, async (tx) => {
      const goal = await this.owned(tx, userId, id);
      this.editable(goal);
      if (goal.trackingMode !== 'ALLOCATIONS') throw new BadRequestException('El objetivo no utiliza asignaciones.');
      await this.validateAllocations(tx, userId, id, goal.currency, allocations);
      const positive = allocations.filter((a) => a.amount > 0);
      await tx.goalAllocation.deleteMany({ where: { goalId: id, walletId: { notIn: positive.map((a) => a.walletId) } } });
      for (const a of positive) {
        await tx.goalAllocation.upsert({ where: { goalId_walletId: { goalId: id, walletId: a.walletId } }, create: { ...a, goalId: id }, update: { amount: a.amount } });
      }
    });
    return this.findOne(userId, id);
  }

  async manualEntry(userId: number, id: number, dto: ManualEntryDto, entryId?: number) {
    if (dto.amount === 0) throw new BadRequestException('El importe no puede ser cero.');
    await withGoalLock(this.prisma, userId, async (tx) => {
      const goal = await this.owned(tx, userId, id);
      this.editable(goal);
      if (goal.trackingMode !== 'MANUAL') throw new BadRequestException('El objetivo no utiliza aportaciones manuales.');
      const previous = entryId == null ? null : goal.manualEntries.find((e) => e.id === entryId);
      if (entryId != null && !previous) throw new NotFoundException('Aportación no encontrada.');
      const after = sumMoney([getGoalCurrentAmount(goal), -Number(previous?.amount ?? 0), dto.amount]);
      if (after < 0) throw new BadRequestException('La retirada supera el dinero registrado en este objetivo.');
      const data = { amount: dto.amount, date: new Date(dto.date), note: dto.note?.trim() || null };
      if (previous) await tx.goalManualEntry.update({ where: { id: previous.id }, data });
      else await tx.goalManualEntry.create({ data: { ...data, goalId: id } });
    });
    return this.findOne(userId, id);
  }

  async removeManualEntry(userId: number, id: number, entryId: number) {
    await withGoalLock(this.prisma, userId, async (tx) => {
      const goal = await this.owned(tx, userId, id);
      this.editable(goal);
      if (goal.trackingMode !== 'MANUAL') throw new BadRequestException('El objetivo no utiliza aportaciones manuales.');
      const entry = goal.manualEntries.find((e) => e.id === entryId);
      if (!entry) throw new NotFoundException('Aportación no encontrada.');
      if (sumMoney([getGoalCurrentAmount(goal), -Number(entry.amount)]) < 0) throw new BadRequestException('Eliminar esta aportación dejaría el objetivo con un saldo negativo.');
      await tx.goalManualEntry.delete({ where: { id: entryId } });
    });
    return this.findOne(userId, id);
  }

  async setStatus(userId: number, id: number, status: GoalStatus) {
    await withGoalLock(this.prisma, userId, async (tx) => {
      const goal = await this.owned(tx, userId, id);
      if (goal.status === status) return;
      this.editable(goal);
      if (status === 'COMPLETED' && getGoalCurrentAmount(goal) < Number(goal.targetAmount)) throw new BadRequestException('Todavía no se ha alcanzado el importe objetivo.');
      await tx.goal.update({ where: { id }, data: {
        status,
        ...(status === 'ARCHIVED' ? { archivedAmount: getGoalCurrentAmount(goal), linkedWalletId: null } : {}),
      } });
    });
    return this.findOne(userId, id);
  }

  async remove(userId: number, id: number) {
    await withGoalLock(this.prisma, userId, async (tx) => {
      await this.owned(tx, userId, id);
      await tx.goal.delete({ where: { id } });
    });
    return { deleted: true };
  }
}
