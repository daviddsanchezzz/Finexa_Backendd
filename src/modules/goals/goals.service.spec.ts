import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateGoalDto, ManualEntryDto, SetAllocationsDto, UpdateGoalDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';
import { withGoalLock } from './goal-reservations';
import { WalletsService } from '../wallets/wallets.service';

describe('Goals reservation rules', () => {
  const goal = (changes: Record<string, unknown> = {}) => ({ id: 1, userId: 7, name: 'Piso', currency: 'EUR', targetAmount: new Prisma.Decimal(1000), trackingMode: 'ALLOCATIONS', status: 'ACTIVE', linkedWallet: null, linkedWalletId: null, targetDate: null, allocations: [], manualEntries: [], ...changes });
  const wallet = (changes: Record<string, unknown> = {}) => ({ id: 10, userId: 7, name: 'Santander', currency: 'EUR', balance: 5000, goalAllocations: [], linkedGoals: [], ...changes });
  let tx: any;
  let prisma: any;
  let service: GoalsService;
  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ locked: 1 }]),
      goal: { findFirst: jest.fn().mockResolvedValue(goal()), findMany: jest.fn().mockResolvedValue([goal()]), create: jest.fn().mockResolvedValue(goal()), update: jest.fn(), delete: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      wallet: { findMany: jest.fn().mockResolvedValue([wallet()]), findFirst: jest.fn().mockResolvedValue(wallet()), update: jest.fn() },
      goalAllocation: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn(), deleteMany: jest.fn(), upsert: jest.fn() },
      goalManualEntry: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    };
    prisma = { ...tx, $transaction: jest.fn((work: (t: any) => unknown) => work(tx)) };
    service = new GoalsService(prisma as PrismaService);
  });
  it('reserves money without writing wallet balances or transactions', async () => {
    await service.setAllocations(7, 1, [{ walletId: 10, amount: 2000 }]);
    expect(tx.goalAllocation.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { amount: 2000 } }));
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: 'Serializable' }));
  });
  it('rejects additional reservations above the unassigned balance', async () => {
    tx.wallet.findMany.mockResolvedValue([wallet({ goalAllocations: [{ amount: 2000 }] })]);
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 4000 }])).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.goalAllocation.upsert).not.toHaveBeenCalled();
  });
  it('allows reducing a reservation after the wallet balance has dropped', async () => {
    tx.wallet.findMany.mockResolvedValue([wallet({ balance: 3000, goalAllocations: [{ amount: 4000 }] })]);
    tx.goalAllocation.findMany.mockResolvedValue([{ walletId: 10, amount: 4000 }]);
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 3500 }])).resolves.toBeDefined();
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 4500 }])).rejects.toBeInstanceOf(BadRequestException);
  });
  it('uses the existing amount when validating an allocation edit', async () => {
    tx.wallet.findMany.mockResolvedValue([wallet({ goalAllocations: [{ amount: 2000 }, { amount: 500 }] })]);
    tx.goalAllocation.findMany.mockResolvedValue([{ walletId: 10, amount: 2000 }]);
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 4500 }])).resolves.toBeDefined();
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 4500.01 }])).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects partially assigning a fully linked wallet', async () => {
    tx.wallet.findMany.mockResolvedValue([wallet({ linkedGoals: [{ id: 2, name: 'Coche' }] })]);
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 1 }])).rejects.toBeInstanceOf(BadRequestException);
  });
  it.each([
    { goalAllocations: [{ amount: 500 }] },
    { linkedGoals: [{ id: 2, name: 'Coche' }] },
  ])('rejects fully linking a wallet with an existing reserve %s', async (changes) => {
    tx.wallet.findMany.mockResolvedValue([wallet(changes)]);
    await expect(service.create(7, { name: 'Piso', targetAmount: 1000, currency: 'EUR', trackingMode: 'WALLET_BALANCE', linkedWalletId: 10 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.goal.create).not.toHaveBeenCalled();
  });
  it('allows a zero balance wallet to be linked', async () => {
    tx.wallet.findMany.mockResolvedValue([wallet({ balance: 0 })]);
    await expect(service.create(7, { name: 'Piso', targetAmount: 1000, currency: 'EUR', trackingMode: 'WALLET_BALANCE', linkedWalletId: 10 })).resolves.toBeDefined();
  });
  it.each([{ wallets: [] }, { wallets: [wallet({ currency: 'USD' })] }])('rejects other users wallets and different currencies', async ({ wallets }) => {
    tx.wallet.findMany.mockResolvedValue(wallets);
    await expect(service.setAllocations(7, 1, [{ walletId: 10, amount: 100 }])).rejects.toBeInstanceOf(BadRequestException);
  });
  it('scopes goal lookup to the authenticated owner', async () => {
    tx.goal.findFirst.mockResolvedValue(null);
    await expect(service.findOne(99, 1)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.goal.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, userId: 99 } }));
  });
  it('creates an initial manual entry rather than a persisted currentAmount', async () => {
    await service.create(7, { name: 'MacBook', targetAmount: 2000, currency: 'EUR', trackingMode: 'MANUAL', initialAmount: 500 });
    expect(tx.goalManualEntry.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ amount: 500, goalId: 1 }) }));
    expect(tx.wallet.update).not.toHaveBeenCalled();
    expect(tx.goal.create.mock.calls[0][0].data).not.toHaveProperty('currentAmount');
  });
  it('does not mix tracking sources', async () => {
    await expect(service.create(7, { name: 'Piso', targetAmount: 1000, currency: 'EUR', trackingMode: 'MANUAL', allocations: [{ walletId: 10, amount: 10 }] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.manualEntry(7, 1, { amount: 10, date: '2026-09-17' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('rejects a manual withdrawal larger than the registered progress', async () => {
    tx.goal.findFirst.mockResolvedValue(goal({ trackingMode: 'MANUAL', manualEntries: [{ id: 3, amount: 100 }] }));
    await expect(service.manualEntry(7, 1, { amount: -101, date: '2026-09-17' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.manualEntry(7, 1, { amount: -100, date: '2026-09-17' })).resolves.toBeDefined();
  });
  it('only edits manual entries belonging to the selected goal', async () => {
    tx.goal.findFirst.mockResolvedValue(goal({ trackingMode: 'MANUAL' }));
    await expect(service.manualEntry(7, 1, { amount: 10, date: '2026-09-17' }, 999)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('preserves reservations when explicitly marking a reached goal as completed', async () => {
    tx.goal.findFirst.mockResolvedValue(goal({ allocations: [{ amount: 1100, walletId: 10, wallet: wallet() }] }));
    await service.setStatus(7, 1, 'COMPLETED');
    expect(tx.goal.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'COMPLETED' } });
    expect(tx.goalAllocation.deleteMany).not.toHaveBeenCalled();
  });
  it('freezes progress on archive and unlinks a wallet without deleting history', async () => {
    tx.goal.findFirst.mockResolvedValue(goal({ trackingMode: 'WALLET_BALANCE', linkedWallet: wallet({ balance: 8250 }), linkedWalletId: 10 }));
    await service.setStatus(7, 1, 'ARCHIVED');
    expect(tx.goal.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: 'ARCHIVED', archivedAmount: 8250, linkedWalletId: null } });
    expect(tx.goalAllocation.deleteMany).not.toHaveBeenCalled();
    expect(tx.goalManualEntry.delete).not.toHaveBeenCalled();
  });
  it('cannot edit an archived goal or complete an unreached goal', async () => {
    await expect(service.setStatus(7, 1, 'COMPLETED')).rejects.toBeInstanceOf(BadRequestException);
    tx.goal.findFirst.mockResolvedValue(goal({ status: 'ARCHIVED' }));
    await expect(service.update(7, 1, { name: 'New' })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('protects wallet deactivation while reservations remain', async () => {
    tx.goal.count.mockResolvedValue(1);
    await expect(new WalletsService(prisma).remove(7, 10)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.wallet.update).not.toHaveBeenCalled();
  });
  it('retries serializable conflicts instead of accepting stale validation', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('conflict', { code: 'P2034', clientVersion: '6.19.0' });
    prisma.$transaction.mockRejectedValueOnce(conflict);
    await expect(withGoalLock(prisma, 7, async () => 42)).resolves.toBe(42);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe('Goal DTO validation', () => {
  it.each([0, -1, 0.001])('rejects an invalid target of %s', async (targetAmount) => {
    expect(await validate(plainToInstance(CreateGoalDto, { name: 'Piso', targetAmount, currency: 'EUR', trackingMode: 'MANUAL' }))).not.toHaveLength(0);
  });
  it('rejects negative allocations and duplicate wallets', async () => {
    expect(await validate(plainToInstance(SetAllocationsDto, { allocations: [{ walletId: 10, amount: -1 }] }))).not.toHaveLength(0);
    expect(await validate(plainToInstance(SetAllocationsDto, { allocations: [{ walletId: 10, amount: 1 }, { walletId: 10, amount: 2 }] }))).not.toHaveLength(0);
  });
  it('permits clearing an optional target date', async () => {
    expect(await validate(plainToInstance(UpdateGoalDto, { targetDate: null }))).toHaveLength(0);
  });
  it('rejects non-finite monetary entries', async () => {
    expect(await validate(plainToInstance(ManualEntryDto, { amount: Infinity, date: '2026-09-17' }))).not.toHaveLength(0);
  });
});
