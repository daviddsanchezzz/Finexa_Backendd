import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrencyService } from '../currency/currency.service';
import { getGoalCurrentAmount } from '../goals/goal-calculations';
import { UpdateFinancialProfileDto } from './dto/financial-profile.dto';
import { SimulateDto } from './dto/simulate.dto';
import {
  CurrentMonth,
  DebtInput,
  GoalInput,
  HealthInputs,
  HealthProfile,
  MonthAgg,
  PortfolioPosition,
  computeHealth,
  simulate,
} from './health-calculations';

const ZONE = 'Europe/Madrid';
const HISTORY_MONTHS = 12;
const PROFILE_FIELDS = ['birthYear', 'incomeType', 'dependents', 'riskTolerance', 'emergencyMonthsTarget', 'fiTargetMultiple', 'fiTargetAge', 'expectedRealReturnPct'] as const;

export interface HistoryPoint {
  key: string;
  income: number;
  expense: number;
  savingsRate: number | null;
  investmentContribution: number;
  partial: boolean;
}

interface Loaded {
  inputs: HealthInputs;
  history: HistoryPoint[];
  currency: string;
}

const monthKey = (d: Date) => DateTime.fromJSDate(d, { zone: ZONE }).toFormat('yyyy-LL');

@Injectable()
export class FinancialHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  // ---------------------------------------------------------------- perfil

  async getProfile(userId: number) {
    const row = await this.prisma.financialProfile.findUnique({ where: { userId } });
    return this.profileDto(row);
  }

  async updateProfile(userId: number, dto: UpdateFinancialProfileDto) {
    // Solo se tocan los campos enviados; null borra el valor.
    const data: Record<string, unknown> = {};
    for (const f of PROFILE_FIELDS) if ((dto as any)[f] !== undefined) data[f] = (dto as any)[f];
    const row = await this.prisma.financialProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return this.profileDto(row);
  }

  private profileDto(row: any | null) {
    const profile: HealthProfile = {
      birthYear: row?.birthYear ?? null,
      incomeType: row?.incomeType ?? null,
      dependents: row?.dependents ?? null,
      riskTolerance: row?.riskTolerance ?? null,
      emergencyMonthsTarget: row?.emergencyMonthsTarget ?? null,
      fiTargetMultiple: row?.fiTargetMultiple ?? null,
      fiTargetAge: row?.fiTargetAge ?? null,
      expectedRealReturnPct: row?.expectedRealReturnPct != null ? Number(row.expectedRealReturnPct) : null,
    };
    const filled = PROFILE_FIELDS.filter((f) => (profile as any)[f] != null).length;
    return { ...profile, completeness: filled / PROFILE_FIELDS.length };
  }

  // --------------------------------------------------------------- informe

  async getReport(userId: number, now: Date = new Date()) {
    const { inputs, history, currency } = await this.load(userId, now);
    const report = computeHealth(inputs);
    return {
      ...report,
      currency,
      history,
      profile: await this.getProfile(userId),
      generatedAt: now.toISOString(),
    };
  }

  async simulate(userId: number, dto: SimulateDto, now: Date = new Date()) {
    const { inputs, currency } = await this.load(userId, now);
    return { ...simulate(inputs, dto), currency };
  }

  // ------------------------------------------------------ lectura de datos

  /** Convierte a la moneda base; si no hay tipo de cambio, deja el importe sin convertir (como getNetWorth). */
  private makeConverter(base: string) {
    const rates = new Map<string, number>();
    return async (amount: number, from: string): Promise<number> => {
      if (!from || from === base) return amount;
      if (!rates.has(from)) {
        try {
          rates.set(from, (await this.currency.getCurrentRate(from, base)).toNumber());
        } catch {
          rates.set(from, 1);
        }
      }
      return amount * (rates.get(from) as number);
    };
  }

  private async load(userId: number, now: Date): Promise<Loaded> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
    const base = user?.currency ?? 'EUR';
    const toBase = this.makeConverter(base);

    const nowM = DateTime.fromJSDate(now, { zone: ZONE });
    const currentKey = nowM.toFormat('yyyy-LL');
    const from = nowM.startOf('month').minus({ months: HISTORY_MONTHS }).toJSDate();

    // Mismas reglas que las estadísticas (dashboard.getSummary2 / filterTransactionsForStats):
    // sin plantillas recurrentes, sin borrados, sin los excluidos de estadísticas.
    const baseWhere = {
      userId,
      active: { not: false },
      isRecurring: false,
      excludeFromStats: { not: true },
      date: { gte: from },
    } as const;

    const [txRows, investRows, wallets, debts, assets, targets, goals, profileRow, manual] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { ...baseWhere, type: { in: ['income', 'expense'] } },
        select: { type: true, amount: true, baseAmount: true, date: true },
      }),
      this.prisma.transaction.findMany({
        where: {
          ...baseWhere,
          type: 'transfer',
          toWallet: { is: { kind: 'investment', active: { not: false } } },
          investmentAssetId: { not: null },
        },
        select: { amount: true, date: true },
      }),
      this.prisma.wallet.findMany({ where: { userId, active: true }, select: { kind: true, balance: true, currency: true } }),
      this.prisma.debt.findMany({
        where: { userId, active: true, status: 'active', direction: 'i_ow' },
        select: { name: true, remainingAmount: true, monthlyPayment: true, interestRate: true, currency: true },
      }),
      this.prisma.investmentAsset.findMany({
        where: { userId, active: true, archived: false },
        select: { id: true, name: true, type: true },
      }),
      this.prisma.investmentTargetAllocation.findMany({ where: { userId, active: true }, select: { assetId: true, targetPct: true } }),
      this.prisma.goal.findMany({
        where: { userId, status: 'ACTIVE' },
        include: { allocations: true, manualEntries: true, linkedWallet: { select: { balance: true } } },
      }),
      this.prisma.financialProfile.findUnique({ where: { userId } }),
      this.prisma.manualMonthData.findMany({ where: { userId, active: true }, select: { year: true, month: true, income: true, expense: true } }),
    ]);

    // ---- meses (Madrid) ----------------------------------------------------
    const agg = new Map<string, MonthAgg>();
    const bucket = (key: string) => {
      if (!agg.has(key)) agg.set(key, { key, income: 0, expense: 0, investmentContribution: 0 });
      return agg.get(key) as MonthAgg;
    };
    for (const t of txRows) {
      const b = bucket(monthKey(t.date));
      const v = Math.abs(Number(t.baseAmount ?? t.amount ?? 0));
      if (t.type === 'income') b.income += v;
      else b.expense += v;
    }
    for (const t of investRows) bucket(monthKey(t.date)).investmentContribution += Math.abs(Number(t.amount ?? 0));

    // Meses sin ningún movimiento: se rellenan con el resumen manual si existe.
    for (const m of manual) {
      const key = `${m.year}-${String(m.month + 1).padStart(2, '0')}`;
      const within = key >= nowM.startOf('month').minus({ months: HISTORY_MONTHS }).toFormat('yyyy-LL') && key < currentKey;
      if (!within || agg.has(key) || (m.income == null && m.expense == null)) continue;
      agg.set(key, { key, income: Math.abs(m.income ?? 0), expense: Math.abs(m.expense ?? 0), investmentContribution: 0 });
    }

    // Desde el primer mes con datos hasta el último completo, rellenando huecos con ceros.
    const keys = [...agg.keys()].filter((k) => k < currentKey).sort();
    const months: MonthAgg[] = [];
    if (keys.length) {
      let cur = DateTime.fromFormat(keys[0], 'yyyy-LL', { zone: ZONE });
      const last = DateTime.fromFormat(keys[keys.length - 1], 'yyyy-LL', { zone: ZONE });
      while (cur <= last) {
        const k = cur.toFormat('yyyy-LL');
        months.push(agg.get(k) ?? { key: k, income: 0, expense: 0, investmentContribution: 0 });
        cur = cur.plus({ months: 1 });
      }
    }

    const cur = agg.get(currentKey);
    const currentMonth: CurrentMonth | null = cur
      ? { income: cur.income, expense: cur.expense, investmentContribution: cur.investmentContribution, daysElapsed: nowM.day, daysInMonth: nowM.daysInMonth ?? 30 }
      : null;

    // ---- saldos ------------------------------------------------------------
    let liquid = 0;
    let invested = 0;
    for (const w of wallets) {
      const v = await toBase(w.balance, w.currency);
      if (w.kind === 'investment') invested += v;
      else if (w.kind === 'cash' || w.kind === 'savings') liquid += v;
    }

    // ---- deudas ------------------------------------------------------------
    const debtInputs: DebtInput[] = [];
    for (const d of debts) {
      debtInputs.push({
        name: d.name,
        remaining: await toBase(d.remainingAmount, d.currency),
        monthlyPayment: d.monthlyPayment != null ? await toBase(d.monthlyPayment, d.currency) : null,
        interestRate: d.interestRate,
      });
    }

    // ---- cartera -----------------------------------------------------------
    const targetByAsset = new Map(targets.map((t) => [t.assetId, Number(t.targetPct)]));
    const snaps = assets.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: { userId, active: true, assetId: { in: assets.map((a) => a.id) } },
          orderBy: { date: 'desc' },
          distinct: ['assetId'],
          select: { assetId: true, value: true, currency: true },
        })
      : [];
    const valueByAsset = new Map<number, number>();
    for (const s of snaps) valueByAsset.set(s.assetId, await toBase(Number(s.value), s.currency));
    const positions: PortfolioPosition[] = assets
      .map((a) => ({ assetId: a.id, name: a.name, type: a.type, value: valueByAsset.get(a.id) ?? 0, targetPct: targetByAsset.get(a.id) ?? null }))
      .filter((p) => p.value > 0 || (p.targetPct ?? 0) > 0);

    // ---- objetivos ---------------------------------------------------------
    const goalInputs: GoalInput[] = [];
    for (const g of goals) {
      const current = getGoalCurrentAmount(g as any);
      goalInputs.push({
        id: g.id,
        name: g.name,
        status: g.status,
        currentAmount: await toBase(current, g.currency),
        targetAmount: await toBase(Number(g.targetAmount), g.currency),
        startDate: g.startDate,
        targetDate: g.targetDate,
      });
    }

    const profile = this.profileDto(profileRow);
    const inputs: HealthInputs = { now, months, currentMonth, liquid, invested, debts: debtInputs, positions, goals: goalInputs, profile };

    const history: HistoryPoint[] = [
      ...months.slice(-HISTORY_MONTHS),
      ...(cur ? [cur] : []),
    ].map((m) => ({
      key: m.key,
      income: m.income,
      expense: m.expense,
      savingsRate: m.income > 0 ? (m.income - m.expense) / m.income : null,
      investmentContribution: m.investmentContribution,
      partial: m.key === currentKey,
    }));

    return { inputs, history, currency: base };
  }
}
