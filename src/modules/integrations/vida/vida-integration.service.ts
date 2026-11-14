import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { DashboardService } from '../../dashboard/dashboard.service';
import { InvestmentsService } from '../../investments/investments.service';
import { BudgetsService } from '../../budgets/budgets.service';
import { GoalsService } from '../../goals/goals.service';
import { DebtsService } from '../../debts/debts.service';
import { MonthDataService } from '../../monthData/month-data.service';
import {
  amountOf,
  currentMonthKey,
  monthRange,
  pctChange,
  previousMonthKey,
  round2,
  summarizeMonth,
  SummaryRow,
} from './vida-integration.utils';

const num = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const TX_SELECT = {
  id: true,
  type: true,
  amount: true,
  baseAmount: true,
  currency: true,
  description: true,
  date: true,
  categoryId: true,
  investmentAssetId: true,
  category: { select: { id: true, name: true, emoji: true, color: true } },
  subcategory: { select: { id: true, name: true, emoji: true } },
  wallet: { select: { id: true, name: true, emoji: true } },
  fromWallet: { select: { id: true, name: true, emoji: true } },
  toWallet: { select: { id: true, name: true, emoji: true, kind: true, active: true } },
} as const;

/**
 * Capa de LECTURA para miVida. Reutiliza los servicios de Finexa (misma lógica que ve la app)
 * y expone un contrato estable y plano: si Finexa cambia por dentro, miVida no se entera.
 * Nada aquí escribe en base de datos.
 */
@Injectable()
export class VidaIntegrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly investments: InvestmentsService,
    private readonly budgets: BudgetsService,
    private readonly goals: GoalsService,
    private readonly debts: DebtsService,
    private readonly monthData: MonthDataService,
  ) {}

  /** Usuario cuyos datos se exponen: el de VIDA_INTEGRATION_USER_EMAIL. */
  async resolveUserId(): Promise<number> {
    const email = (process.env.VIDA_INTEGRATION_USER_EMAIL ?? '').trim().toLowerCase();
    if (!email) throw new ServiceUnavailableException('Integración sin usuario configurado.');
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario de la integración no encontrado.');
    return user.id;
  }

  private range(month?: string) {
    const key = month ?? currentMonthKey();
    const range = monthRange(key);
    if (!range) throw new BadRequestException('El mes debe tener formato AAAA-MM.');
    return range;
  }

  private async monthRows(userId: number, start: Date, end: Date): Promise<SummaryRow[]> {
    return this.prisma.transaction.findMany({
      where: { userId, active: true, isRecurring: false, excludeFromStats: false, date: { gte: start, lt: end } },
      select: TX_SELECT,
    }) as unknown as SummaryRow[];
  }

  async ping() {
    const userId = await this.resolveUserId();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, currency: true } });
    return { ok: true, name: user?.name ?? null, currency: user?.currency ?? 'EUR', now: new Date().toISOString() };
  }

  async overview(month?: string) {
    const userId = await this.resolveUserId();
    const range = this.range(month);
    const prevKey = previousMonthKey(range.key)!;
    const prevRange = monthRange(prevKey)!;

    const [netWorth, rows, prevRows, closes, invest, recurring] = await Promise.all([
      this.dashboard.getNetWorth(userId),
      this.monthRows(userId, range.start, range.end),
      this.monthRows(userId, prevRange.start, prevRange.end),
      this.monthData.findAll(userId),
      this.investments.getSummary(userId),
      this.recurring(),
    ]);

    const current = summarizeMonth(rows, range);
    const previous = summarizeMonth(prevRows, prevRange);

    // «Este mes» del patrimonio = patrimonio actual − cierre del mes anterior (cierre manual de Finexa).
    const prevClose = closes.find((c: any) => c.year === prevRange.year && c.month === prevRange.month0)?.finalBalance;
    const isCurrent = range.key === currentMonthKey();
    const monthDelta = isCurrent && prevClose != null ? round2(netWorth.total - Number(prevClose)) : null;

    return {
      month: range.key,
      currency: netWorth.currency,
      netWorth: {
        total: round2(netWorth.total),
        monthDelta,
        monthDeltaPct: monthDelta != null && prevClose != null ? pctChange(netWorth.total, Number(prevClose)) : null,
        wallets: netWorth.wallets.map((w: any) => ({
          id: w.id,
          name: w.name,
          emoji: w.emoji ?? null,
          balance: round2(num(w.balance)),
          currency: w.currency,
          balanceInBase: round2(num(w.balanceInBase)),
        })),
      },
      totals: current.totals,
      previous: { month: prevKey, ...previous.totals },
      comparison: {
        expensesPct: pctChange(current.totals.expenses, previous.totals.expenses),
        incomePct: pctChange(current.totals.income, previous.totals.income),
      },
      investments: {
        currentValue: round2(num(invest.totalCurrentValue)),
        netContributed: round2(num(invest.totalNetContributed)),
        pnl: round2(num(invest.totalPnL)),
        returnPct: invest.returnPct == null ? null : round2(num(invest.returnPct) * 100),
      },
      upcoming: recurring.items.filter((r) => r.nextDate && !r.paused && !r.finished).slice(0, 5),
      generatedAt: new Date().toISOString(),
    };
  }

  async transactions(params: { month?: string; limit?: number; type?: string }) {
    const userId = await this.resolveUserId();
    const range = this.range(params.month);
    const limit = Math.min(Math.max(Math.trunc(params.limit ?? 200), 1), 500);
    const type = ['income', 'expense', 'transfer'].includes(params.type ?? '') ? params.type : undefined;

    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        active: true,
        isRecurring: false,
        date: { gte: range.start, lt: range.end },
        ...(type ? { type } : {}),
      },
      select: TX_SELECT,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return {
      month: range.key,
      items: rows.map((t: any) => ({
        id: t.id,
        type: t.type,
        amount: round2(amountOf(t)),
        originalAmount: round2(Math.abs(num(t.amount))),
        currency: t.currency,
        description: t.description ?? '',
        date: iso(t.date),
        category: t.category ? { id: t.category.id, name: t.category.name, emoji: t.category.emoji, color: t.category.color } : null,
        subcategory: t.subcategory ? { id: t.subcategory.id, name: t.subcategory.name, emoji: t.subcategory.emoji } : null,
        wallet: t.wallet ?? null,
        from: t.fromWallet ?? null,
        to: t.toWallet ? { id: t.toWallet.id, name: t.toWallet.name, emoji: t.toWallet.emoji } : null,
        isInvestment: t.investmentAssetId != null,
      })),
    };
  }

  /** Estadísticas del mes: gasto/ingreso por categoría, semanas y días + comparación con el mes anterior. */
  async stats(month?: string) {
    const userId = await this.resolveUserId();
    const range = this.range(month);
    const prevRange = monthRange(previousMonthKey(range.key)!)!;
    const [rows, prevRows] = await Promise.all([
      this.monthRows(userId, range.start, range.end),
      this.monthRows(userId, prevRange.start, prevRange.end),
    ]);
    const current = summarizeMonth(rows, range);
    const previous = summarizeMonth(prevRows, prevRange);
    return {
      month: range.key,
      ...current,
      previous: { month: prevRange.key, ...previous.totals },
      comparison: {
        expensesPct: pctChange(current.totals.expenses, previous.totals.expenses),
        incomePct: pctChange(current.totals.income, previous.totals.income),
      },
    };
  }

  async investmentsSummary() {
    const userId = await this.resolveUserId();
    const s = await this.investments.getSummary(userId);
    const total = num(s.totalCurrentValue);
    return {
      currentValue: round2(total),
      invested: round2(num(s.totalNetContributed)),
      pnl: round2(num(s.totalPnL)),
      returnPct: s.returnPct == null ? null : round2(num(s.returnPct) * 100),
      asOf: s.asOf,
      assets: (s.assets as any[]).map((a) => ({
        id: a.id,
        name: a.name,
        abbreviation: a.abbreviation,
        type: String(a.type),
        riskType: a.riskType == null ? null : String(a.riskType),
        currency: a.currency,
        currentValue: round2(num(a.currentValueBase ?? a.currentValue)),
        invested: round2(num(a.invested)),
        pnl: round2(num(a.pnl)),
        returnPct: a.returnPct == null ? null : round2(num(a.returnPct) * 100),
        dayReturnPct: a.dayReturnPct == null ? null : round2(num(a.dayReturnPct) * 100),
        monthReturnPct: a.monthReturnPct == null ? null : round2(num(a.monthReturnPct) * 100),
        ytdReturnPct: a.ytdReturnPct == null ? null : round2(num(a.ytdReturnPct) * 100),
        weightPct: total > 0 ? round2((num(a.currentValueBase ?? a.currentValue) / total) * 100) : 0,
      })),
    };
  }

  async budgetsOverview() {
    const userId = await this.resolveUserId();
    const o: any = await this.budgets.overview(userId, {} as any);
    return {
      summary: {
        totalLimit: round2(num(o.summary?.totalLimit)),
        totalSpent: round2(num(o.summary?.totalSpent)),
        remaining: round2(num(o.summary?.remaining)),
      },
      items: (o.budgets as any[]).map((b) => {
        const limit = b.effectiveTotalLimit ?? null;
        const spent = num(b.globalSpent);
        return {
          id: b.id,
          name: b.name ?? 'Presupuesto',
          period: String(b.period),
          from: b.range?.from ?? null,
          to: b.range?.to ?? null,
          limit: limit == null ? null : round2(num(limit)),
          spent: round2(spent),
          remaining: limit == null ? null : round2(Math.max(num(limit) - spent, 0)),
          pct: limit ? round2((spent / num(limit)) * 100) : null,
        };
      }),
    };
  }

  async goalsOverview() {
    const userId = await this.resolveUserId();
    const { goals } = await this.goals.findAll(userId);
    return {
      items: (goals as any[]).map((g) => ({
        id: g.id,
        name: g.name,
        icon: g.icon ?? null,
        color: g.color ?? null,
        status: String(g.status),
        currency: g.currency,
        current: round2(num(g.currentAmount)),
        target: round2(num(g.targetAmount)),
        remaining: round2(num(g.remainingAmount)),
        pct: round2(num(g.displayProgress)),
        reached: !!g.reached,
        targetDate: iso(g.targetDate),
        requiredMonthly: g.requiredMonthlyContribution == null ? null : round2(num(g.requiredMonthlyContribution)),
      })),
    };
  }

  async debtsOverview() {
    const userId = await this.resolveUserId();
    const debts = (await this.debts.findAll(userId)) as any[];
    const items = debts.map((d) => ({
      id: d.id,
      name: d.name,
      entity: d.entity ?? null,
      emoji: d.emoji ?? null,
      direction: String(d.direction),
      status: String(d.status),
      currency: d.currency,
      total: round2(num(d.totalAmount)),
      paid: round2(num(d.payed)),
      remaining: round2(num(d.remainingAmount)),
      monthlyPayment: d.monthlyPayment == null ? null : round2(num(d.monthlyPayment)),
      nextDueDate: iso(d.nextDueDate),
    }));
    const open = items.filter((i) => i.status !== 'closed' && i.status !== 'paid');
    return {
      owed: round2(open.filter((i) => i.direction === 'i_ow').reduce((s, i) => s + i.remaining, 0)),
      owedToMe: round2(open.filter((i) => i.direction !== 'i_ow').reduce((s, i) => s + i.remaining, 0)),
      items,
    };
  }

  /** Plantillas recurrentes; `date` guarda la próxima ejecución. */
  async recurring() {
    const userId = await this.resolveUserId();
    const rows = await this.prisma.transaction.findMany({
      where: { userId, active: true, isRecurring: true },
      select: { ...TX_SELECT, recurrence: true, paused: true, endDate: true },
      orderBy: { date: 'asc' },
    });
    const now = new Date();
    const items = (rows as any[]).map((t) => ({
      id: t.id,
      type: t.type,
      amount: round2(amountOf(t)),
      currency: t.currency,
      description: t.description ?? '',
      category: t.category ? { id: t.category.id, name: t.category.name, emoji: t.category.emoji } : null,
      recurrence: t.recurrence ?? null,
      nextDate: iso(t.date),
      endDate: iso(t.endDate),
      paused: !!t.paused,
      finished: !!t.endDate && t.endDate < now,
    }));
    return { items };
  }
}
