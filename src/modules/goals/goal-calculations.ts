import { GoalTrackingMode, Prisma } from '@prisma/client';

type Money = number | Prisma.Decimal;
const decimal = (n: Money) => new Prisma.Decimal(n);
export const sumMoney = (values: Money[]) => values.reduce<Prisma.Decimal>((sum, value) => sum.plus(value), decimal(0)).toNumber();
const roundMoney = (value: number) => decimal(value).toDecimalPlaces(2).toNumber();

export function getGoalCurrentAmount(goal: {
  status?: string;
  archivedAmount?: Money | null;
  trackingMode: GoalTrackingMode;
  manualEntries: { amount: Money }[];
  allocations: { amount: Money }[];
  linkedWallet: { balance: number } | null;
}) {
  if (goal.status === 'ARCHIVED' && goal.archivedAmount != null) return Number(goal.archivedAmount);
  switch (goal.trackingMode) {
    case 'MANUAL': return sumMoney(goal.manualEntries.map((e) => e.amount));
    case 'ALLOCATIONS': return sumMoney(goal.allocations.map((a) => a.amount));
    case 'WALLET_BALANCE': return roundMoney(Math.max(goal.linkedWallet?.balance ?? 0, 0));
  }
}

export function getGoalMetrics(target: Money, currentAmount: number, targetDate: Date | null, today = new Date()) {
  const targetAmount = Number(target);
  const remainingAmount = roundMoney(Math.max(targetAmount - currentAmount, 0));
  const progressPercentage = targetAmount > 0 ? currentAmount / targetAmount * 100 : 0;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const targetUtc = targetDate ? Date.UTC(targetDate.getUTCFullYear(), targetDate.getUTCMonth(), targetDate.getUTCDate()) : null;
  const daysRemaining = targetUtc == null ? null : Math.ceil((targetUtc - todayUtc) / 86400000);
  const remainingMonths = daysRemaining != null && daysRemaining > 0 ? Math.max(daysRemaining / (365.25 / 12), 1) : null;
  return {
    currentAmount, targetAmount, remainingAmount, progressPercentage,
    displayProgress: Math.min(100, Math.max(progressPercentage, 0)),
    excessAmount: roundMoney(Math.max(currentAmount - targetAmount, 0)),
    reached: currentAmount >= targetAmount,
    daysRemaining,
    overdue: daysRemaining != null && daysRemaining < 0 && remainingAmount > 0,
    requiredMonthlyContribution: remainingMonths && remainingAmount > 0 ? roundMoney(remainingAmount / remainingMonths) : null,
  };
}

export function getWalletAvailability(balance: number, allocations: Money[], fullyLinked: boolean) {
  const eligibleBalance = roundMoney(Math.max(balance, 0));
  const allocatedAmount = fullyLinked ? eligibleBalance : sumMoney(allocations);
  return {
    balance: roundMoney(balance), eligibleBalance, allocatedAmount, fullyLinked,
    availableToAllocate: fullyLinked ? 0 : roundMoney(Math.max(eligibleBalance - allocatedAmount, 0)),
    overAllocated: fullyLinked ? 0 : roundMoney(Math.max(allocatedAmount - eligibleBalance, 0)),
  };
}

export function getGoalSummary(goals: { status: string; currency: string; currentAmount: number; targetAmount: number; remainingAmount: number }[]) {
  return [...new Set(goals.map((g) => g.currency))].map((currency) => {
    const active = goals.filter((g) => g.status === 'ACTIVE' && g.currency === currency);
    const totalSaved = sumMoney(active.map((g) => g.currentAmount));
    const totalTarget = sumMoney(active.map((g) => g.targetAmount));
    const globalProgress = totalTarget > 0 ? totalSaved / totalTarget * 100 : 0;
    return { currency, totalSaved, totalTarget, totalRemaining: sumMoney(active.map((g) => g.remainingAmount)), activeCount: active.length, globalProgress, displayProgress: Math.min(100, Math.max(globalProgress, 0)) };
  });
}
