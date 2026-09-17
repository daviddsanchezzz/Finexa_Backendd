import { Prisma } from '@prisma/client';
import { getGoalCurrentAmount, getGoalMetrics, getGoalSummary, getWalletAvailability } from './goal-calculations';

describe('Goal calculations', () => {
  const base = { manualEntries: [], allocations: [], linkedWallet: null };
  it('uses manual history without counting allocations or a wallet twice', () => {
    expect(getGoalCurrentAmount({ ...base, trackingMode: 'MANUAL', manualEntries: [{ amount: new Prisma.Decimal(500) }, { amount: -100 }], allocations: [{ amount: 900 }], linkedWallet: { balance: 1000 } })).toBe(400);
  });
  it('adds money with decimal precision', () => {
    expect(getGoalCurrentAmount({ ...base, trackingMode: 'ALLOCATIONS', allocations: [{ amount: 0.1 }, { amount: 0.2 }] })).toBe(0.3);
  });
  it.each([[-500, 0], [0, 0], [8250, 8250]])('observes a wallet balance of %s as %s', (balance, expected) => {
    expect(getGoalCurrentAmount({ ...base, trackingMode: 'WALLET_BALANCE', linkedWallet: { balance } })).toBe(expected);
  });
  it('preserves an archived snapshot after the wallet is unlinked', () => {
    expect(getGoalCurrentAmount({ ...base, trackingMode: 'WALLET_BALANCE', status: 'ARCHIVED', archivedAmount: new Prisma.Decimal(8250) })).toBe(8250);
  });
  it('preserves progress above 100 percent while clamping only the bar', () => {
    expect(getGoalMetrics(10000, 10500, null)).toMatchObject({ progressPercentage: 105, displayProgress: 100, excessAmount: 500, remainingAmount: 0, reached: true, requiredMonthlyContribution: null });
  });
  it('does not offset another goal remaining amount with an excess', () => {
    const summary = getGoalSummary([
      { status: 'ACTIVE', currency: 'EUR', currentAmount: 1100, targetAmount: 1000, remainingAmount: 0 },
      { status: 'ACTIVE', currency: 'EUR', currentAmount: 100, targetAmount: 1000, remainingAmount: 900 },
      { status: 'COMPLETED', currency: 'EUR', currentAmount: 300, targetAmount: 300, remainingAmount: 0 },
      { status: 'ARCHIVED', currency: 'EUR', currentAmount: 900, targetAmount: 1000, remainingAmount: 100 },
      { status: 'ACTIVE', currency: 'USD', currentAmount: 500, targetAmount: 1000, remainingAmount: 500 },
    ]);
    expect(summary).toEqual(expect.arrayContaining([
      expect.objectContaining({ currency: 'EUR', totalSaved: 1200, totalTarget: 2000, totalRemaining: 900, activeCount: 2 }),
      expect.objectContaining({ currency: 'USD', totalSaved: 500, totalRemaining: 500 }),
    ]));
  });
  it('calculates a simple monthly requirement only for a future deadline', () => {
    const today = new Date('2026-09-17T00:00:00Z');
    const metrics = getGoalMetrics(30000, 12000, new Date('2029-09-17T00:00:00Z'), today);
    expect(metrics.requiredMonthlyContribution).toBeCloseTo(500, 0);
    expect(getGoalMetrics(1000, 0, new Date('2026-09-16'), today)).toMatchObject({ overdue: true, requiredMonthlyContribution: null });
    expect(getGoalMetrics(1000, 1000, new Date('2029-09-17'), today).requiredMonthlyContribution).toBeNull();
    expect(getGoalMetrics(1000, 0, new Date('2026-09-17'), today).requiredMonthlyContribution).toBeNull();
  });
  it('detects a balance drop without silently reducing reservations', () => {
    expect(getWalletAvailability(3000, [1500, 2500], false)).toMatchObject({ allocatedAmount: 4000, availableToAllocate: 0, overAllocated: 1000 });
  });
  it('fully linked wallets have no money available for another reservation', () => {
    expect(getWalletAvailability(5000, [], true)).toMatchObject({ allocatedAmount: 5000, availableToAllocate: 0, fullyLinked: true });
  });
});
