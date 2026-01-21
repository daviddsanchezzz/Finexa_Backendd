// src/investments/investments.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateInvestmentAssetDto } from './dto/create-investment-asset.dto';
import { UpdateInvestmentAssetDto } from './dto/update-investment-asset.dto';
import { CreateInvestmentValuationDto } from './dto/create-valuation.dto';
import { UpdateInvestmentValuationDto } from './dto/update-valuation.dto';

/**
 * IMPORTANT (schema alignment)
 * --------------------------------
 * This service assumes InvestmentOperation.type can store:
 *  - transfer_in, transfer_out, buy, sell, swap_in, swap_out
 *
 * Update your Prisma enum InvestmentOperationType accordingly, and remove any legacy values:
 *   enum InvestmentOperationType {
 *     transfer_in
 *     transfer_out
 *     buy
 *     sell
 *     swap_in
 *     swap_out
 *   }
 *
 * If you keep a different enum, you must map values consistently (do NOT rely on `as any` long-term).
 */

@Injectable()
export class InvestmentsService {
  constructor(private prisma: PrismaService) {}

  // =============================
  // Helpers (validation & parsing)
  // =============================
  private requireInt(x: any, label: string) {
    const n = Number(x);
    if (!Number.isInteger(n)) throw new BadRequestException(`Invalid ${label}`);
    return n;
  }

  private parseAmount(x: any, label: string) {
    const n = Number(x);
    if (!Number.isFinite(n) || n <= 0) throw new BadRequestException(`Invalid ${label}`);
    return n;
  }

  private parseNonNegative(x: any, label: string) {
    const n = Number(x);
    if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`Invalid ${label}`);
    return n;
  }

  private parseFee(x: any) {
    return this.parseNonNegative(x ?? 0, 'fee');
  }

  private parseDate(x: any) {
    const d = x ? new Date(x) : new Date();
    if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
  }

  // Normalize "date-only" in UTC (00:00:00Z) to avoid duplicated snapshots by time component
  private startOfUtcDay(d: Date) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  private normalizeCurrency(x: any, fallback = 'EUR') {
    const c = (x ?? fallback).toString().trim().toUpperCase();
    return c || fallback;
  }

  private async assertAssetOwned(userId: number, assetId: number) {
    if (!Number.isInteger(assetId)) throw new BadRequestException('Invalid assetId');

    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
      select: { id: true },
    });

    if (!asset) throw new NotFoundException('Investment asset not found');
    return true;
  }

  private async assertWalletKind(
    userId: number,
    walletId: number,
    kind: 'cash' | 'investment',
  ) {
    if (!Number.isInteger(walletId)) throw new BadRequestException('Invalid walletId');

    const w = await this.prisma.wallet.findFirst({
      where: { id: walletId, userId, active: true },
      select: { id: true, kind: true, balance: true },
    });

    if (!w) throw new NotFoundException('Wallet not found');

    if (String(w.kind) !== kind) {
      throw new BadRequestException(`Wallet ${walletId} must be a ${kind} wallet`);
    }

    return w;
  }

  /**
   * HARD RULE: exactly 1 investment wallet.
   */
  private async getSingleInvestmentWallet(userId: number) {
    const wallets = await this.prisma.wallet.findMany({
      where: { userId, active: true, kind: 'investment' as any },
      select: { id: true },
      orderBy: { position: 'asc' },
      take: 2,
    });

    if (wallets.length === 0) throw new BadRequestException('No investment wallet found');
    if (wallets.length > 1) {
      throw new BadRequestException(
        'Multiple investment wallets found. This version supports exactly 1 investment wallet.',
      );
    }
    return wallets[0].id;
  }

  /**
   * Atomic cash decrement to avoid race conditions:
   * update balance only if balance >= amount.
   */
  private async atomicDecrementCashWallet(
    tx: any,
    userId: number,
    cashWalletId: number,
    amount: number,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Invalid amount');

    const updated = await tx.wallet.updateMany({
      where: {
        id: cashWalletId,
        userId,
        active: true,
        kind: 'cash' as any,
        balance: { gte: amount },
      },
      data: { balance: { decrement: amount } },
    });

    if (updated.count !== 1) {
      throw new BadRequestException('Insufficient funds');
    }
  }

  // =============================
  // Portfolio Value (for snapshots)
  // =============================

  /**
   * Portfolio mark-to-model at a target date:
   * - For each asset: last valuation <= target (if exists), else fallback to "book value"
   * - Book value is computed from initialInvested + cash in/out + swaps in/out
   *   (swaps are included here to keep per-asset allocation coherent when user swaps)
   */
  private async getPortfolioValueAt(userId: number, target: Date): Promise<number> {
    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      select: { id: true, initialInvested: true },
    });

    const assetIds = assets.map((a) => a.id);
    if (assetIds.length === 0) return 0;

    const ops = await this.prisma.investmentOperation.findMany({
      where: {
        userId,
        active: true,
        assetId: { in: assetIds },
        date: { lte: target },
        type: { in: ['transfer_in', 'buy', 'transfer_out', 'sell', 'swap_in', 'swap_out'] as any },
      },
      select: { assetId: true, type: true, amount: true },
    });

    // Book value allocation (includes swaps)
    const inflow = new Set(['transfer_in', 'buy', 'swap_in']);
    const outflow = new Set(['transfer_out', 'sell', 'swap_out']);

    const bookByAsset = new Map<number, number>();
    for (const a of assets) bookByAsset.set(a.id, Number(a.initialInvested ?? 0));

    for (const o of ops) {
      const t = String(o.type);
      const amt = Number(o.amount ?? 0);
      const delta = inflow.has(t) ? amt : outflow.has(t) ? -amt : 0;
      if (delta) bookByAsset.set(o.assetId, (bookByAsset.get(o.assetId) ?? 0) + delta);
    }

    const latestDates = await this.prisma.investmentValuationSnapshot.groupBy({
      by: ['assetId'],
      where: { userId, active: true, assetId: { in: assetIds }, date: { lte: target } },
      _max: { date: true },
    });

    const pairs = latestDates
      .filter((r) => r._max.date)
      .map((r) => ({ assetId: r.assetId, date: r._max.date! }));

    const snaps = pairs.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: { userId, active: true, OR: pairs },
          select: { assetId: true, date: true, value: true },
        })
      : [];

    const snapMap = new Map<number, { date: Date; value: number }>();
    for (const s of snaps) {
      const prev = snapMap.get(s.assetId);
      if (!prev || s.date > prev.date) snapMap.set(s.assetId, { date: s.date, value: Number(s.value ?? 0) });
    }

    let total = 0;
    for (const assetId of assetIds) {
      const v = snapMap.get(assetId)?.value;
      total += v ?? (bookByAsset.get(assetId) ?? 0);
    }
    return total;
  }

  // =============================
  // Investment wallet balance recalculation
  // =============================

  /**
   * Recalculates investment wallet balance = sum(last valuation per asset), fallback to "book value".
   * Book value includes swaps to preserve allocation after swaps.
   */
  private async recalcInvestmentWalletBalance(userId: number) {
    const investmentWalletId = await this.getSingleInvestmentWallet(userId);

    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      select: { id: true, initialInvested: true },
    });

    if (assets.length === 0) {
      await this.prisma.wallet.update({ where: { id: investmentWalletId }, data: { balance: 0 } });
      return;
    }

    const assetIds = assets.map((a) => a.id);

    const ops = await this.prisma.investmentOperation.findMany({
      where: { userId, active: true, assetId: { in: assetIds } },
      select: { assetId: true, type: true, amount: true },
    });

    // Book value allocation (includes swaps)
    const inflowTypes = new Set(['transfer_in', 'buy', 'swap_in']);
    const outflowTypes = new Set(['transfer_out', 'sell', 'swap_out']);

    const aggMap = new Map<number, { inflow: number; outflow: number }>();
    for (const o of ops) {
      const prev = aggMap.get(o.assetId) ?? { inflow: 0, outflow: 0 };
      const t = String(o.type);
      const amt = Number(o.amount ?? 0);

      if (inflowTypes.has(t)) prev.inflow += amt;
      else if (outflowTypes.has(t)) prev.outflow += amt;

      aggMap.set(o.assetId, prev);
    }

    const latestDates = await this.prisma.investmentValuationSnapshot.groupBy({
      by: ['assetId'],
      where: { userId, active: true, assetId: { in: assetIds } },
      _max: { date: true },
    });

    const latestPairs = latestDates
      .filter((r) => r._max.date)
      .map((r) => ({ assetId: r.assetId, date: r._max.date! }));

    const latestSnapshots = latestPairs.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: { userId, active: true, OR: latestPairs },
          select: { assetId: true, value: true, date: true },
        })
      : [];

    const snapshotMap = new Map<number, { value: number; date: Date }>();
    for (const s of latestSnapshots) {
      const prev = snapshotMap.get(s.assetId);
      if (!prev || s.date > prev.date) snapshotMap.set(s.assetId, { value: Number(s.value ?? 0), date: s.date });
    }

    let totalCurrentValue = 0;

    for (const a of assets) {
      const agg = aggMap.get(a.id) ?? { inflow: 0, outflow: 0 };

      const initial = Number(a.initialInvested ?? 0);
      const bookValue = initial + agg.inflow - agg.outflow;

      const snap = snapshotMap.get(a.id);
      const currentValue = snap?.value ?? bookValue;

      totalCurrentValue += Number(currentValue ?? 0);
    }

    await this.prisma.wallet.update({
      where: { id: investmentWalletId },
      data: { balance: totalCurrentValue },
    });
  }

  // =============================
  // Assets (CRUD)
  // =============================
  async createAsset(userId: number, dto: CreateInvestmentAssetDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');

    const currency = this.normalizeCurrency(dto.currency, 'EUR');
    const initialInvested = this.parseNonNegative(dto.initialInvested ?? 0, 'initialInvested');

    return this.prisma.investmentAsset.create({
      data: {
        userId,
        name,
        description: dto.description?.trim() || null,
        type: dto.type ?? 'custom',
        riskType: (dto as any).riskType,
        currency,
        initialInvested,
        active: true,
      },
    });
  }

  async listAssets(userId: number) {
    return this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async getAsset(userId: number, id: number) {
    if (!Number.isInteger(id)) throw new BadRequestException('Invalid assetId');

    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id, userId, active: true },
    });
    if (!asset) throw new NotFoundException('Investment asset not found');
    return asset;
  }

  async updateAsset(userId: number, id: number, dto: UpdateInvestmentAssetDto) {
    await this.getAsset(userId, id);

    const data: any = {};

    if (dto.name !== undefined) {
      const n = String(dto.name).trim();
      if (!n) throw new BadRequestException('Name cannot be empty');
      data.name = n;
    }

    if (dto.type !== undefined) data.type = dto.type;
    if ((dto as any).riskType !== undefined) data.riskType = (dto as any).riskType;

    if (dto.currency !== undefined) {
      const c = String(dto.currency).trim().toUpperCase();
      if (!c) throw new BadRequestException('Currency cannot be empty');
      data.currency = c;
    }

    if (dto.initialInvested !== undefined) {
      data.initialInvested = this.parseNonNegative(dto.initialInvested, 'initialInvested');
    }

    if ('description' in (dto as any)) {
      const raw = (dto as any).description;
      data.description = raw && String(raw).trim() ? String(raw).trim() : null;
    }

    const updated = await this.prisma.investmentAsset.update({ where: { id }, data });

    await this.recalcInvestmentWalletBalance(userId);
    return updated;
  }

  async deleteAsset(userId: number, id: number) {
    await this.getAsset(userId, id);

    const deleted = await this.prisma.investmentAsset.update({
      where: { id },
      data: { active: false },
    });

    await this.recalcInvestmentWalletBalance(userId);
    return deleted;
  }

  // =============================
  // Valuations (Snapshots)
  // =============================
  async createValuation(userId: number, dto: CreateInvestmentValuationDto) {
    await this.assertAssetOwned(userId, dto.assetId);

    const rawDate = new Date(dto.date);
    if (Number.isNaN(rawDate.getTime())) throw new BadRequestException('Invalid date');
    const date = this.startOfUtcDay(rawDate); // normalize day to avoid duplicates by time

    const value = this.parseNonNegative(dto.value, 'value');
    const currency = this.normalizeCurrency(dto.currency, 'EUR');

    const valuation = await this.prisma.investmentValuationSnapshot.upsert({
      where: {
        userId_assetId_date: { userId, assetId: dto.assetId, date },
      },
      update: { value, currency, active: true },
      create: { userId, assetId: dto.assetId, date, value, currency, active: true },
    });

    await this.recalcInvestmentWalletBalance(userId);
    return valuation;
  }

  async listValuations(userId: number, assetId?: number) {
    if (assetId !== undefined) {
      if (!Number.isInteger(assetId)) throw new BadRequestException('Invalid assetId');
      await this.assertAssetOwned(userId, assetId);
    }

    return this.prisma.investmentValuationSnapshot.findMany({
      where: {
        userId,
        active: true,
        ...(assetId !== undefined ? { assetId } : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  async getValuationById(userId: number, id: number) {
    const v = await this.prisma.investmentValuationSnapshot.findFirst({
      where: { id, userId, active: true },
    });

    if (!v) throw new NotFoundException('Valoración no encontrada');
    return v;
  }

  async updateValuation(userId: number, id: number, dto: UpdateInvestmentValuationDto) {
    if (!Number.isInteger(id)) throw new BadRequestException('Invalid valuation id');

    const existing = await this.prisma.investmentValuationSnapshot.findFirst({
      where: { id, userId, active: true },
    });
    if (!existing) throw new NotFoundException('Valuation snapshot not found');

    if (dto.assetId !== undefined) {
      if (!Number.isInteger(dto.assetId)) throw new BadRequestException('Invalid assetId');
      await this.assertAssetOwned(userId, dto.assetId);
    }

    const data: any = {};

    if (dto.assetId !== undefined) data.assetId = dto.assetId;

    if (dto.date !== undefined) {
      const raw = new Date(dto.date);
      if (Number.isNaN(raw.getTime())) throw new BadRequestException('Invalid date');
      data.date = this.startOfUtcDay(raw);
    }

    if (dto.value !== undefined) data.value = this.parseNonNegative(dto.value, 'value');
    if (dto.currency !== undefined) data.currency = this.normalizeCurrency(dto.currency, 'EUR');

    const updated = await this.prisma.investmentValuationSnapshot.update({ where: { id }, data });

    await this.recalcInvestmentWalletBalance(userId);
    return updated;
  }

  async deleteValuation(userId: number, id: number) {
    if (!Number.isInteger(id)) throw new BadRequestException('Invalid valuation id');

    const existing = await this.prisma.investmentValuationSnapshot.findFirst({
      where: { id, userId, active: true },
    });
    if (!existing) throw new NotFoundException('Valuation snapshot not found');

    const deleted = await this.prisma.investmentValuationSnapshot.update({
      where: { id },
      data: { active: false },
    });

    await this.recalcInvestmentWalletBalance(userId);
    return deleted;
  }

  // =============================
  // Summary (cash flows vs book allocation)
  // =============================
  async getSummary(userId: number) {
    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        riskType: true,
        currency: true,
        initialInvested: true,
      },
    });

    const assetIds = assets.map((a) => a.id);
    if (assetIds.length === 0) {
      return {
        totalInvested: 0,
        totalCurrentValue: 0,
        totalPnL: 0,
        totalContributed: 0,
        totalWithdrawn: 0,
        totalNetContributed: 0,
        assets: [],
      };
    }

    // Cash flows (true contributions/withdrawals)
    const cashInTypes = new Set(['transfer_in', 'buy']);
    const cashOutTypes = new Set(['transfer_out', 'sell']);

    // Book allocation (includes swaps)
    const bookInTypes = new Set(['transfer_in', 'buy', 'swap_in']);
    const bookOutTypes = new Set(['transfer_out', 'sell', 'swap_out']);

    const ops = await this.prisma.investmentOperation.findMany({
      where: { userId, active: true, assetId: { in: assetIds } },
      select: { assetId: true, type: true, amount: true },
    });

    const agg = new Map<
      number,
      { cashIn: number; cashOut: number; bookIn: number; bookOut: number }
    >();

    for (const o of ops) {
      const t = String(o.type);
      const amt = Number(o.amount ?? 0);
      const prev = agg.get(o.assetId) ?? { cashIn: 0, cashOut: 0, bookIn: 0, bookOut: 0 };

      if (cashInTypes.has(t)) prev.cashIn += amt;
      else if (cashOutTypes.has(t)) prev.cashOut += amt;

      if (bookInTypes.has(t)) prev.bookIn += amt;
      else if (bookOutTypes.has(t)) prev.bookOut += amt;

      agg.set(o.assetId, prev);
    }

    const latestDates = await this.prisma.investmentValuationSnapshot.groupBy({
      by: ['assetId'],
      where: { userId, active: true, assetId: { in: assetIds } },
      _max: { date: true },
    });

    const latestPairs = latestDates
      .filter((r) => r._max.date)
      .map((r) => ({ assetId: r.assetId, date: r._max.date! }));

    const latestSnapshots = latestPairs.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: { userId, active: true, OR: latestPairs },
          select: { assetId: true, value: true, date: true, currency: true },
        })
      : [];

    const snapshotMap = new Map<number, { value: number; date: Date; currency: string }>();
    for (const s of latestSnapshots) {
      const prev = snapshotMap.get(s.assetId);
      if (!prev || s.date > prev.date) snapshotMap.set(s.assetId, { value: Number(s.value ?? 0), date: s.date, currency: s.currency });
    }

    const perAsset = assets.map((a) => {
      const aAgg = agg.get(a.id) ?? { cashIn: 0, cashOut: 0, bookIn: 0, bookOut: 0 };

      const initial = Number(a.initialInvested ?? 0);

      const totalContributed = initial + aAgg.cashIn; // true cash contributed
      const totalWithdrawn = aAgg.cashOut;            // true cash withdrawn
      const netContributed = totalContributed - totalWithdrawn;

      // book value allocation (used as fallback if no valuations)
      const bookValue = initial + aAgg.bookIn - aAgg.bookOut;

      const snap = snapshotMap.get(a.id);
      const currentValue = snap?.value ?? bookValue;
      const pnl = currentValue - netContributed; // PnL vs true net cash contributed

      return {
        id: a.id,
        name: a.name,
        description: a.description,
        type: a.type,
        riskType: (a as any).riskType,
        currency: a.currency,

        totalContributed,
        totalWithdrawn,
        netContributed,

        invested: netContributed, // kept for backward compatibility: "true invested"
        currentValue,
        pnl,
        lastValuationDate: snap?.date ?? null,
      };
    });

    const totalContributed = perAsset.reduce((acc, x) => acc + x.totalContributed, 0);
    const totalWithdrawn = perAsset.reduce((acc, x) => acc + x.totalWithdrawn, 0);
    const totalNetContributed = totalContributed - totalWithdrawn;

    const totalCurrentValue = perAsset.reduce((acc, x) => acc + x.currentValue, 0);
    const totalPnL = totalCurrentValue - totalNetContributed;

    return {
      totalInvested: totalNetContributed,
      totalCurrentValue,
      totalPnL,
      totalContributed,
      totalWithdrawn,
      totalNetContributed,
      assets: perAsset,
    };
  }

  // =============================
  // Time series: per-asset
  // =============================
  async getAssetSeries(userId: number, assetId: number) {
    await this.assertAssetOwned(userId, assetId);

    return this.prisma.investmentValuationSnapshot.findMany({
      where: { userId, assetId, active: true },
      orderBy: { date: 'asc' },
      select: { date: true, value: true, currency: true },
    });
  }

  // =============================
  // Time series: portfolio total (daily)
  // =============================
  private toDayKeyUTC(d: Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private addUtcDays(d: Date, days: number) {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() + days);
    return x;
  }

  async getPortfolioTimeline(userId: number, days = 90) {
    const n = Math.max(7, Math.min(365, Number(days) || 90));
    const now = new Date();
    const toExclusive = this.addUtcDays(this.startOfUtcDay(now), 1);
    const from = this.addUtcDays(this.startOfUtcDay(now), -n + 1);

    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      select: { id: true, initialInvested: true },
    });

    const assetIds = assets.map((a) => a.id);
    if (assetIds.length === 0) return { points: [] };

    const bookInTypes = new Set(['transfer_in', 'buy', 'swap_in']);
    const bookOutTypes = new Set(['transfer_out', 'sell', 'swap_out']);

    // Seed equity (last valuation <= from)
    const seedDates = await this.prisma.investmentValuationSnapshot.groupBy({
      by: ['assetId'],
      where: { userId, active: true, assetId: { in: assetIds }, date: { lte: from } },
      _max: { date: true },
    });

    const seedPairs = seedDates
      .filter((r) => r._max.date)
      .map((r) => ({ assetId: r.assetId, date: r._max.date! }));

    const seedSnaps = seedPairs.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: { userId, active: true, OR: seedPairs },
          select: { assetId: true, date: true, value: true },
        })
      : [];

    const seedValueMap = new Map<number, { date: Date; value: number }>();
    for (const s of seedSnaps) {
      const prev = seedValueMap.get(s.assetId);
      if (!prev || s.date > prev.date) seedValueMap.set(s.assetId, { date: s.date, value: Number(s.value ?? 0) });
    }

    const valuations = await this.prisma.investmentValuationSnapshot.findMany({
      where: {
        userId,
        active: true,
        assetId: { in: assetIds },
        date: { gte: from, lt: toExclusive },
      },
      orderBy: { date: 'asc' },
      select: { assetId: true, date: true, value: true },
    });

    const valuationsByDay = new Map<string, Map<number, number>>();
    for (const v of valuations) {
      const dayKey = this.toDayKeyUTC(v.date);
      if (!valuationsByDay.has(dayKey)) valuationsByDay.set(dayKey, new Map());
      valuationsByDay.get(dayKey)!.set(v.assetId, Number(v.value ?? 0));
    }

    // Book value by asset as "netContributions" line (includes swaps to keep allocation)
    const bookByAsset = new Map<number, number>();
    for (const a of assets) bookByAsset.set(a.id, Number(a.initialInvested ?? 0));

    const ops = await this.prisma.investmentOperation.findMany({
      where: {
        userId,
        active: true,
        assetId: { in: assetIds },
        date: { lt: toExclusive },
      },
      select: { assetId: true, type: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    });

    const opsByDay = new Map<string, Array<{ assetId: number; delta: number }>>();

    for (const o of ops) {
      const t = String(o.type);
      const amt = Number(o.amount ?? 0);
      const delta = bookInTypes.has(t) ? amt : bookOutTypes.has(t) ? -amt : 0;
      if (!delta) continue;

      const dayKey = this.toDayKeyUTC(o.date);

      // seed < from
      if (o.date < from) {
        bookByAsset.set(o.assetId, (bookByAsset.get(o.assetId) ?? 0) + delta);
        continue;
      }

      if (!opsByDay.has(dayKey)) opsByDay.set(dayKey, []);
      opsByDay.get(dayKey)!.push({ assetId: o.assetId, delta });
    }

    const lastKnown = new Map<number, number>();
    for (const assetId of assetIds) {
      const seedSnap = seedValueMap.get(assetId)?.value;
      const fallback = bookByAsset.get(assetId) ?? 0;
      lastKnown.set(assetId, seedSnap ?? fallback);
    }

    const points: Array<{
      date: string;
      totalCurrentValue: number;
      equity: number;
      netContributions: number;
    }> = [];

    let cursor = new Date(from);

    while (cursor < toExclusive) {
      const dayKey = this.toDayKeyUTC(cursor);

      const dayOps = opsByDay.get(dayKey);
      if (dayOps) {
        for (const { assetId, delta } of dayOps) {
          bookByAsset.set(assetId, (bookByAsset.get(assetId) ?? 0) + delta);
        }
      }

      const updates = valuationsByDay.get(dayKey);
      if (updates) {
        for (const [assetId, val] of updates.entries()) lastKnown.set(assetId, val);
      }

      let equity = 0;
      for (const assetId of assetIds) equity += lastKnown.get(assetId) ?? 0;

      let netContributions = 0;
      for (const assetId of assetIds) netContributions += bookByAsset.get(assetId) ?? 0;

      points.push({
        date: dayKey,
        totalCurrentValue: equity, // compatibility
        equity,
        netContributions,
      });

      cursor = this.addUtcDays(cursor, 1);
    }

    return { points };
  }

// =============================
// Operaciones (movimientos de inversión)
// =============================
//
// Idea general del módulo:
// - Cada operación de inversión genera (casi siempre) 2 cosas:
//   1) Un "Transaction" (registro contable general) para que aparezca en el histórico
//   2) Un "InvestmentOperation" (registro específico) para poder calcular cartera/inversiones
//
// - Todas las operaciones se ejecutan en una transacción de BD (prisma.$transaction)
//   para que NO se quede nada a medias si algo falla.
//
// - Tras cada operación, recalculamos el balance de la "wallet" de inversión
//   (una wallet especial que agrupa el valor total invertido).
//
// Nota importante sobre fees/comisiones:
// - En "deposit" y "buy": el dinero sale de cash, y la comisión también => outflow = amount + fee
// - En "withdraw" y "sell": aquí asumimos que dto.amount es NETO (lo que recibe el usuario),
//   y fee es informativo a menos que modeles también el "bruto".


/**
 * DEPOSIT: cash -> investment (entrada a inversión)
 * - Usuario mete dinero desde una wallet de cash hacia la wallet de inversión.
 * - La comisión (fee) se paga también desde la wallet de cash.
 * - En Transaction guardamos el total que salió de cash (amount + fee).
 * - En InvestmentOperation guardamos:
 *   - amount = principal (lo invertido)
 *   - fee = comisión
 */
async depositAsset(userId: number, assetId: number, dto: any) {
  // 1) Seguridad: el asset debe ser del usuario
  await this.assertAssetOwned(userId, assetId);

  // 2) Parseos/validaciones
  const amount = this.parseAmount(dto.amount, 'amount'); // principal invertido
  const fee = this.parseFee(dto.fee);                    // comisión (>= 0)
  const date = this.parseDate(dto.date);                 // fecha válida

  // 3) Origen: wallet de cash (de dónde sale el dinero)
  const fromWalletId = this.requireInt(dto.fromWalletId, 'fromWalletId');
  await this.assertWalletKind(userId, fromWalletId, 'cash'); // debe ser wallet tipo cash

  // 4) Destino: wallet única de inversión (centralizada)
  const invWalletId = await this.getSingleInvestmentWallet(userId);

  // 5) Descripción por defecto
  const description = dto.description?.trim() || 'Deposit investment';

  // 6) Ejecutamos todo atómico
  const result = await this.prisma.$transaction(async (tx) => {
    // fee se paga desde cash: total que sale de cash
    const totalOutflow = amount + fee;

    // 6.1) Actualizamos balance de cash de forma atómica (decrement)
    await this.atomicDecrementCashWallet(tx, userId, fromWalletId, totalOutflow);

    // 6.2) Creamos la transacción "general" (para historial)
    // - amount = totalOutflow porque es lo que salió de cash realmente
    const createdTx = await tx.transaction.create({
      data: {
        userId,
        type: 'transfer',              // lo modelas como transferencia entre wallets
        amount: totalOutflow,          // salida total (principal + fee)
        description,
        date,
        fromWalletId,
        toWalletId: invWalletId,       // entra a la wallet de inversión
        investmentAssetId: assetId,    // vinculado al asset
        active: true,
        source: 'investment',          // etiqueta para diferenciar origen
      },
    });

    // 6.3) Creamos la operación de inversión (detalle financiero)
    const op = await tx.investmentOperation.create({
      data: {
        userId,
        assetId,
        type: 'transfer_in' as any,    // entrada a inversión
        date,
        amount,                        // SOLO principal
        fee,                           // comisión
        transactionId: createdTx.id,   // enlace con Transaction
        active: true,
      },
    });

    return { transaction: createdTx, operation: op };
  });

  // 7) Recalcular la wallet de inversión (para reflejar el valor total)
  await this.recalcInvestmentWalletBalance(userId);
  return result;
}


/**
 * WITHDRAW: investment -> cash (salida desde inversión)
 * - Usuario retira dinero desde la wallet de inversión hacia una wallet de cash.
 * - SUPOSICIÓN: dto.amount es NETO (lo que el usuario recibe).
 * - fee se guarda como informativo (si quieres "bruto", necesitas modelarlo aparte).
 */
async withdrawAsset(userId: number, assetId: number, dto: any) {
  await this.assertAssetOwned(userId, assetId);

  const amountNet = this.parseAmount(dto.amount, 'amount'); // neto recibido
  const fee = this.parseFee(dto.fee);                       // informativo (si no modelas bruto)
  const date = this.parseDate(dto.date);

  // Wallet destino: cash
  const toWalletId = this.requireInt(dto.toWalletId, 'toWalletId');
  await this.assertWalletKind(userId, toWalletId, 'cash');

  // Wallet origen: inversión
  const invWalletId = await this.getSingleInvestmentWallet(userId);

  const description = dto.description?.trim() || 'Withdraw investment';

  const result = await this.prisma.$transaction(async (tx) => {
    // 1) Creamos Transaction general (transferencia investment -> cash)
    const createdTx = await tx.transaction.create({
      data: {
        userId,
        type: 'transfer',
        amount: amountNet,             // aquí guardas lo que realmente llega (neto)
        description,
        date,
        fromWalletId: invWalletId,
        toWalletId,
        investmentAssetId: assetId,
        active: true,
        source: 'investment',
      },
    });

    // 2) Creamos InvestmentOperation específica
    const op = await tx.investmentOperation.create({
      data: {
        userId,
        assetId,
        type: 'transfer_out' as any,   // salida de inversión
        date,
        amount: amountNet,             // guardas neto
        fee,                           // informativo
        transactionId: createdTx.id,
        active: true,
      },
    });

    // 3) Incrementamos el cash wallet porque el usuario recibe dinero
    await tx.wallet.update({
      where: { id: toWalletId },
      data: { balance: { increment: amountNet } },
    });

    return { transaction: createdTx, operation: op };
  });

  await this.recalcInvestmentWalletBalance(userId);
  return result;
}


/**
 * BUY: cash -> investment (compra de un asset)
 * - Similar a deposit, pero semánticamente es una "compra".
 * - Sale cash: amount + fee
 * - En Transaction registras total outflow
 * - En InvestmentOperation: tipo buy, amount principal y fee
 */
async buyAsset(userId: number, assetId: number, dto: any) {
  await this.assertAssetOwned(userId, assetId);

  const amount = this.parseAmount(dto.amount, 'amount'); // principal
  const fee = this.parseFee(dto.fee);
  const date = this.parseDate(dto.date);

  const fromWalletId = this.requireInt(dto.fromWalletId, 'fromWalletId');
  await this.assertWalletKind(userId, fromWalletId, 'cash');

  const invWalletId = await this.getSingleInvestmentWallet(userId);

  const description = dto.description?.trim() || 'Buy asset';

  const result = await this.prisma.$transaction(async (tx) => {
    // Total que sale de cash = principal + comisión
    const totalOutflow = amount + fee;

    // Decremento atómico de cash
    await this.atomicDecrementCashWallet(tx, userId, fromWalletId, totalOutflow);

    // Transaction general (transfer cash -> inv)
    const createdTx = await tx.transaction.create({
      data: {
        userId,
        type: 'transfer',
        amount: totalOutflow,
        description,
        date,
        fromWalletId,
        toWalletId: invWalletId,
        investmentAssetId: assetId,
        active: true,
        source: 'investment',
      },
    });

    // Operation específica buy
    const op = await tx.investmentOperation.create({
      data: {
        userId,
        assetId,
        type: 'buy' as any,
        date,
        amount,                      // principal
        fee,                         // comisión
        transactionId: createdTx.id,
        active: true,
      },
    });

    return { transaction: createdTx, operation: op };
  });

  await this.recalcInvestmentWalletBalance(userId);
  return result;
}


/**
 * SELL: investment -> cash (venta de un asset)
 * - SUPOSICIÓN: dto.amount es NETO recibido.
 * - Crea Transaction transfer investment -> cash con amountNet
 * - Crea InvestmentOperation tipo sell con amountNet y fee informativo
 * - Incrementa la wallet de cash
 */
async sellAsset(userId: number, assetId: number, dto: any) {
  await this.assertAssetOwned(userId, assetId);

  const amountNet = this.parseAmount(dto.amount, 'amount');
  const fee = this.parseFee(dto.fee); // informativo a menos que modeles bruto
  const date = this.parseDate(dto.date);

  const toWalletId = this.requireInt(dto.toWalletId, 'toWalletId');
  await this.assertWalletKind(userId, toWalletId, 'cash');

  const invWalletId = await this.getSingleInvestmentWallet(userId);

  const description = dto.description?.trim() || 'Sell investment';

  const result = await this.prisma.$transaction(async (tx) => {
    // Transaction general
    const createdTx = await tx.transaction.create({
      data: {
        userId,
        type: 'transfer',
        amount: amountNet,
        description,
        date,
        fromWalletId: invWalletId,
        toWalletId,
        investmentAssetId: assetId,
        active: true,
        source: 'investment',
      },
    });

    // Operation específica sell
    const op = await tx.investmentOperation.create({
      data: {
        userId,
        assetId,
        type: 'sell' as any,
        date,
        amount: amountNet,
        fee,
        transactionId: createdTx.id,
        active: true,
      },
    });

    // El usuario recibe cash => incrementamos wallet destino
    await tx.wallet.update({
      where: { id: toWalletId },
      data: { balance: { increment: amountNet } },
    });

    return { transaction: createdTx, operation: op };
  });

  await this.recalcInvestmentWalletBalance(userId);
  return result;
}


/**
 * SWAP: asset A -> asset B (sin mover wallets)
 * - Intercambio entre dos assets.
 * - No se crea Transaction general (porque no hay cash involved).
 * - Se crean 2 InvestmentOperation:
 *   - swap_out: sale del asset A
 *   - swap_in : entra al asset B
 * - Ambas comparten swapGroupId para vincularlas y poder borrar el swap "como unidad".
 */
async swapAssets(userId: number, dto: any) {
  // 1) IDs de assets
  const fromAssetId = this.requireInt(dto.fromAssetId, 'fromAssetId');
  const toAssetId = this.requireInt(dto.toAssetId, 'toAssetId');

  // 2) No tiene sentido swappear el mismo asset
  if (fromAssetId === toAssetId) {
    throw new BadRequestException('fromAssetId and toAssetId must be different');
  }

  // 3) Seguridad: ambos assets deben ser del usuario
  await this.assertAssetOwned(userId, fromAssetId);
  await this.assertAssetOwned(userId, toAssetId);

  // 4) Cantidades
  const amountOut = this.parseAmount(dto.amountOut, 'amountOut'); // lo que "sale" del asset A

  // amountIn: si no viene, usamos amountOut (swap 1:1 por defecto)
  const amountIn = Number(dto.amountIn ?? dto.amountOut);
  if (!Number.isFinite(amountIn) || amountIn <= 0) {
    throw new BadRequestException('Invalid amountIn');
  }

  const fee = this.parseFee(dto.fee);
  const date = this.parseDate(dto.date);

  // 5) swapGroupId: permite agrupar las dos patas del swap
  const swapGroupId =
    (dto.swapGroupId && String(dto.swapGroupId).trim()) ||
    `swap_${userId}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  const result = await this.prisma.$transaction(async (tx) => {
    // Pata de salida (asset A)
    const outOp = await tx.investmentOperation.create({
      data: {
        userId,
        assetId: fromAssetId,
        type: 'swap_out' as any,
        date,
        amount: amountOut,
        fee,              // asignamos fee al out leg (decisión de modelado)
        swapGroupId,
        active: true,
      },
    });

    // Pata de entrada (asset B)
    const inOp = await tx.investmentOperation.create({
      data: {
        userId,
        assetId: toAssetId,
        type: 'swap_in' as any,
        date,
        amount: amountIn,
        fee: 0,           // fee ya lo imputamos al out leg
        swapGroupId,
        active: true,
      },
    });

    return { swapGroupId, outOperation: outOp, inOperation: inOp };
  });

  await this.recalcInvestmentWalletBalance(userId);
  return result;
}


/**
 * Eliminar un swap por swapGroupId
 * - Busca las operaciones swap_in y swap_out activas del grupo
 * - Si no hay, 404
 * - Si hay, hace "soft delete" (active: false)
 * - Recalcula wallet de inversión
 */
async deleteSwap(userId: number, swapGroupId: string) {
  const sg = (swapGroupId ?? '').trim();
  if (!sg) throw new BadRequestException('swapGroupId is required');

  // 1) Verificamos que exista algo que borrar
  const ops = await this.prisma.investmentOperation.findMany({
    where: {
      userId,
      active: true,
      swapGroupId: sg,
      type: { in: ['swap_in', 'swap_out'] as any },
    },
    select: { id: true },
  });

  if (ops.length === 0) throw new NotFoundException('Swap not found');

  // 2) Soft delete de ambas patas
  await this.prisma.investmentOperation.updateMany({
    where: { userId, swapGroupId: sg, type: { in: ['swap_in', 'swap_out'] as any } },
    data: { active: false },
  });

  await this.recalcInvestmentWalletBalance(userId);
  return { swapGroupId: sg, deletedCount: ops.length };
}

  async recalcInvestmentWallet(userId: number) {
    await this.recalcInvestmentWalletBalance(userId);
  }

  async listOperations(userId: number, assetId: number, active?: boolean) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
      select: { id: true },
    });
    if (!asset) throw new BadRequestException('Asset no encontrado');

    const where: any = { userId, assetId };
    if (typeof active === 'boolean') where.active = active;

    return this.prisma.investmentOperation.findMany({
      where,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        userId: true,
        assetId: true,
        type: true,
        date: true,
        amount: true,
        fee: true,
        transactionId: true,
        swapGroupId: true,
        createdAt: true,
        updatedAt: true,
        active: true,
      },
    });
  }
  // =============================
// Month boundaries (UTC)
// =============================

private startOfMonthUTC(y: number, m1to12: number) {
  return new Date(Date.UTC(y, m1to12 - 1, 1, 0, 0, 0, 0));
}

private nextMonthStartUTC(y: number, m1to12: number) {
  // 00:00Z del día 1 del mes siguiente
  return new Date(Date.UTC(y, m1to12, 1, 0, 0, 0, 0));
}

private normalizeToMonthStartUTC(d: Date) {
  const y = d.getUTCFullYear();
  const m1 = d.getUTCMonth() + 1;
  return this.startOfMonthUTC(y, m1);
}

// =============================
// Portfolio monthly snapshots (editable) — at month start boundary
// =============================

async upsertPortfolioSnapshot(userId: number, date: Date, isAuto: boolean) {
  // ✅ normaliza a 00:00Z del día 1 del mes (boundary)
  const normalizedDate = this.normalizeToMonthStartUTC(date);

  const totalValue = await this.getPortfolioValueAt(userId, normalizedDate);

  const existing = await this.prisma.portfolioSnapshot.findFirst({
    where: { userId, date: normalizedDate, active: true },
  });

  if (existing) {
    return this.prisma.portfolioSnapshot.update({
      where: { id: existing.id },
      data: {
        totalValue,
        isAuto,
        // preserve user edits:
        // do not touch editedValue/isEdited/editedValue
      },
    });
  }

  return this.prisma.portfolioSnapshot.create({
    data: {
      userId,
      date: normalizedDate,
      totalValue,
      currency: "EUR",
      isAuto,
      active: true,
    },
  });
}

async editPortfolioSnapshot(userId: number, id: number, dto: { editedValue: number; note?: string }) {
  const s = await this.prisma.portfolioSnapshot.findFirst({
    where: { id, userId, active: true },
  });
  if (!s) throw new NotFoundException("Snapshot not found");

  const editedValue = Number(dto.editedValue);
  if (!Number.isFinite(editedValue) || editedValue < 0) {
    throw new BadRequestException("editedValue inválido");
  }

  return this.prisma.portfolioSnapshot.update({
    where: { id },
    data: {
      isEdited: true,
      editedValue,
      editedAt: new Date(),
      note: dto.note?.trim() || null,
    },
  });
}

private effectiveSnapshotValue(s: { totalValue: any; isEdited: boolean; editedValue: any }) {
  const v = s.isEdited ? (s.editedValue ?? s.totalValue) : s.totalValue;
  return Number(v ?? 0);
}

private async getBoundaryValue(userId: number, boundary: Date) {
  const snap = await this.prisma.portfolioSnapshot.findFirst({
    where: { userId, date: boundary, active: true },
    select: { id: true, totalValue: true, isEdited: true, editedValue: true },
  });

  if (snap) {
    return {
      source: "snapshot" as const,
      snapshotId: snap.id,
      value: this.effectiveSnapshotValue(snap as any),
    };
  }

  // ✅ No hay snapshot: calculamos al vuelo
  const computed = await this.getPortfolioValueAt(userId, boundary);
  return {
    source: "computed" as const,
    snapshotId: null as number | null,
    value: Number(computed ?? 0),
  };
}

private async getMonthCashFlow(userId: number, startInclusive: Date, nextStartExclusive: Date) {
  const ops = await this.prisma.investmentOperation.findMany({
    where: {
      userId,
      active: true,
      date: { gte: startInclusive, lt: nextStartExclusive },
      type: { in: ["transfer_in", "buy", "transfer_out", "sell"] as any },
    },
    select: { type: true, amount: true, fee: true },
  });

  let cf = 0;

  for (const o of ops) {
    const t = String(o.type);
    const amt = Number(o.amount ?? 0);
    const fee = Number(o.fee ?? 0);

    if (t === "transfer_in" || t === "buy") {
      cf += amt + fee; // cash out
    } else if (t === "transfer_out" || t === "sell") {
      cf -= amt; // cash in (amount neto)
    }
  }

  return cf;
}

async getMonthlyPerformance(userId: number, fromYM: string, toYM: string) {
  const months = this.monthRange(fromYM, toYM);

  const out: Array<{
    period: string;
    startValue: number;
    endValue: number;
    netCashFlow: number;
    returnAmount: number;
    returnPct: number | null;

    // opcional (muy útil para UI / debug)
    startSource: "snapshot" | "computed";
    endSource: "snapshot" | "computed";
    startSnapshotId: number | null;
    endSnapshotId: number | null;
  }> = [];

  for (const { y, m } of months) {
    const startBoundary = this.startOfMonthUTC(y, m);
    const endBoundary = this.nextMonthStartUTC(y, m);

    const s0 = await this.getBoundaryValue(userId, startBoundary);
    const s1 = await this.getBoundaryValue(userId, endBoundary);

    const CF = await this.getMonthCashFlow(userId, startBoundary, endBoundary);

    const V0 = s0.value;
    const V1 = s1.value;

    const returnAmount = V1 - V0 - CF;
    const returnPct = V0 > 0 ? returnAmount / V0 : null;

    out.push({
      period: `${y}-${String(m).padStart(2, "0")}`,
      startValue: V0,
      endValue: V1,
      netCashFlow: CF,
      returnAmount,
      returnPct,
      startSource: s0.source,
      endSource: s1.source,
      startSnapshotId: s0.snapshotId,
      endSnapshotId: s1.snapshotId,
    });
  }

  let compoundedReturn: number | null = null;
  const valid = out.filter((x) => typeof x.returnPct === "number") as Array<{ returnPct: number }>;
  if (valid.length) {
    compoundedReturn = valid.reduce((acc, x) => acc * (1 + x.returnPct), 1) - 1;
  }

  return { months: out, compoundedReturn };
}

// =============================
// Month parsing + range (UTC)
// =============================

private parseYM(input: string, label: string): { y: number; m: number } {
  const raw = String(input ?? '').trim();
  const m = /^(\d{4})-(\d{2})$/.exec(raw);
  if (!m) throw new BadRequestException(`${label} must be YYYY-MM`);

  const y = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isInteger(y) || y < 1900 || y > 3000) {
    throw new BadRequestException(`${label} year out of range`);
  }
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) {
    throw new BadRequestException(`${label} month must be 01-12`);
  }

  return { y, m: mm };
}

/**
 * Inclusive month range between fromYM and toYM (both YYYY-MM).
 * Example: monthRange("2025-11","2026-02") => [{2025,11},{2025,12},{2026,1},{2026,2}]
 */
private monthRange(fromYM: string, toYM: string): Array<{ y: number; m: number }> {
  const from = this.parseYM(fromYM, 'fromYM');
  const to = this.parseYM(toYM, 'toYM');

  const fromIndex = from.y * 12 + (from.m - 1);
  const toIndex = to.y * 12 + (to.m - 1);

  if (toIndex < fromIndex) {
    throw new BadRequestException('toYM must be >= fromYM');
  }

  const out: Array<{ y: number; m: number }> = [];
  for (let idx = fromIndex; idx <= toIndex; idx++) {
    const y = Math.floor(idx / 12);
    const m = (idx % 12) + 1;
    out.push({ y, m });
  }

  // Optional hard cap to protect the DB from huge ranges
  if (out.length > 240) {
    throw new BadRequestException('Range too large (max 240 months)');
  }

  return out;
}


}
