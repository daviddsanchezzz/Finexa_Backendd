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

@Injectable()
export class InvestmentsService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------
  // Helpers (validation & parsing)
  // -----------------------------
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
    if (isNaN(d.getTime())) throw new BadRequestException('Invalid date');
    return d;
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
   * HARD RULE: solo existe 1 wallet de inversión.
   * - Se usa siempre la primera por position.
   * - Si hay 0 -> error.
   * - Si hay >1 -> error (para evitar inconsistencias silenciosas).
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
   * Recalcula el balance de la ÚNICA wallet de inversión:
   * balance = suma( lastSnapshot(asset) ) con fallback netContributed
   *
   * netContributed = initialInvested + (transfer_in + buy + swap_in) - (transfer_out + sell + swap_out)
   */
  private async recalcInvestmentWalletBalance(userId: number) {
    const investmentWalletId = await this.getSingleInvestmentWallet(userId);

    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      select: { id: true, initialInvested: true },
    });

    if (assets.length === 0) {
      await this.prisma.wallet.update({
        where: { id: investmentWalletId },
        data: { balance: 0 },
      });
      return;
    }

    const assetIds = assets.map((a) => a.id);

    const ops = await this.prisma.investmentOperation.findMany({
      where: { userId, active: true, assetId: { in: assetIds } },
      select: { assetId: true, type: true, amount: true },
    });

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
      if (!prev || s.date > prev.date) snapshotMap.set(s.assetId, { value: s.value, date: s.date });
    }

    let totalCurrentValue = 0;

    for (const a of assets) {
      const agg = aggMap.get(a.id) ?? { inflow: 0, outflow: 0 };

      const initial = Number(a.initialInvested ?? 0);
      const totalContributed = initial + agg.inflow;
      const totalWithdrawn = agg.outflow;
      const netContributed = totalContributed - totalWithdrawn;

      const snap = snapshotMap.get(a.id);
      const currentValue = snap?.value ?? netContributed;

      totalCurrentValue += Number(currentValue ?? 0);
    }

    await this.prisma.wallet.update({
      where: { id: investmentWalletId },
      data: { balance: totalCurrentValue },
    });
  }

  private async assertCashSufficient(tx: any, userId: number, cashWalletId: number, amount: number) {
    const w = await tx.wallet.findFirst({
      where: { id: cashWalletId, userId, active: true },
      select: { balance: true, kind: true },
    });
    if (!w) throw new NotFoundException('Wallet not found');
    if (String(w.kind) !== 'cash') throw new BadRequestException('Wallet must be a cash wallet');

    if (Number(w.balance) < amount) {
      throw new BadRequestException('Insufficient funds');
    }
  }

  // -----------------------------
  // Assets (CRUD)
  // -----------------------------
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

    const updated = await this.prisma.investmentAsset.update({
      where: { id },
      data,
    });

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

  // -----------------------------
  // Valuations (Snapshots)
  // -----------------------------
  async createValuation(userId: number, dto: CreateInvestmentValuationDto) {
    await this.assertAssetOwned(userId, dto.assetId);

    const date = new Date(dto.date);
    if (isNaN(date.getTime())) throw new BadRequestException('Invalid date');

    const value = this.parseNonNegative(dto.value, 'value');
    const currency = this.normalizeCurrency(dto.currency, 'EUR');

    const valuation = await this.prisma.investmentValuationSnapshot.upsert({
      where: {
        userId_assetId_date: {
          userId,
          assetId: dto.assetId,
          date,
        },
      },
      update: {
        value,
        currency,
        active: true,
      },
      create: {
        userId,
        assetId: dto.assetId,
        date,
        value,
        currency,
        active: true,
      },
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

  if (!v) throw new NotFoundException("Valoración no encontrada");
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
      const d = new Date(dto.date);
      if (isNaN(d.getTime())) throw new BadRequestException('Invalid date');
      data.date = d;
    }

    if (dto.value !== undefined) {
      data.value = this.parseNonNegative(dto.value, 'value');
    }

    if (dto.currency !== undefined) {
      data.currency = this.normalizeCurrency(dto.currency, 'EUR');
    }

    const updated = await this.prisma.investmentValuationSnapshot.update({
      where: { id },
      data,
    });

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

  // -----------------------------
  // Summary
  // -----------------------------
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

    const inflowTypes = new Set(['transfer_in', 'buy', 'swap_in']);
    const outflowTypes = new Set(['transfer_out', 'sell', 'swap_out']);

    const ops = await this.prisma.investmentOperation.findMany({
      where: { userId, active: true, assetId: { in: assetIds } },
      select: { assetId: true, type: true, amount: true },
    });

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
          select: { assetId: true, value: true, date: true, currency: true },
        })
      : [];

    const snapshotMap = new Map<number, { value: number; date: Date; currency: string }>();
    for (const s of latestSnapshots) {
      const prev = snapshotMap.get(s.assetId);
      if (!prev || s.date > prev.date) {
        snapshotMap.set(s.assetId, { value: s.value, date: s.date, currency: s.currency });
      }
    }

    const perAsset = assets.map((a) => {
      const agg = aggMap.get(a.id) ?? { inflow: 0, outflow: 0 };

      const totalContributed = Number(a.initialInvested ?? 0) + agg.inflow;
      const totalWithdrawn = agg.outflow;
      const netContributed = totalContributed - totalWithdrawn;

      const snap = snapshotMap.get(a.id);
      const currentValue = snap?.value ?? netContributed;
      const pnl = currentValue - netContributed;

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

        invested: netContributed, // backward compatibility
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

  // -----------------------------
  // Time series: per-asset
  // -----------------------------
  async getAssetSeries(userId: number, assetId: number) {
    await this.assertAssetOwned(userId, assetId);

    return this.prisma.investmentValuationSnapshot.findMany({
      where: { userId, assetId, active: true },
      orderBy: { date: 'asc' },
      select: { date: true, value: true, currency: true },
    });
  }

  // -----------------------------
  // Time series: portfolio total (last-known per asset)
  // -----------------------------
  private toDayKeyUTC(d: Date) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private startOfUtcDay(d: Date) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
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

  const inflowTypes = new Set(['transfer_in', 'buy', 'swap_in']);
  const outflowTypes = new Set(['transfer_out', 'sell', 'swap_out']);

  // -----------------------------
  // 1) Seed de EQUITY (last known valuation <= from)
  //    Optimizado: groupBy max(date) por asset y luego findMany
  // -----------------------------
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

  // Valoraciones en rango (para ir actualizando lastKnown)
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

  // -----------------------------
  // 2) Seed de NET CONTRIBUTIONS
  //    - Start con initialInvested
  //    - Aplica operaciones < from para seedear contrib a inicio de ventana
  //    - Aplica operaciones en [from, toExclusive) por día para evolucionar
  // -----------------------------
  // (a) mapa inicial por asset
  const netContribByAsset = new Map<number, number>();
  for (const a of assets) netContribByAsset.set(a.id, Number(a.initialInvested ?? 0));

  // (b) operaciones hasta toExclusive (para seed + updates). Filtramos por fecha para evitar cargar todo el histórico.
  const ops = await this.prisma.investmentOperation.findMany({
    where: {
      userId,
      active: true,
      assetId: { in: assetIds },
      date: { lt: toExclusive }, // importante
    },
    select: { assetId: true, type: true, amount: true, date: true },
    orderBy: { date: 'asc' },
  });

  // opsByDay: solo las ops dentro del rango visible
  const opsByDay = new Map<string, Array<{ assetId: number; delta: number }>>();

  for (const o of ops) {
    const t = String(o.type);
    const amt = Number(o.amount ?? 0);
    const delta = inflowTypes.has(t) ? amt : outflowTypes.has(t) ? -amt : 0;
    if (!delta) continue;

    const dayKey = this.toDayKeyUTC(o.date);

    // si la op es ANTES de 'from', cuenta para seed
    if (o.date < from) {
      netContribByAsset.set(o.assetId, (netContribByAsset.get(o.assetId) ?? 0) + delta);
      continue;
    }

    // si está en rango, la guardamos para aplicarla día a día
    if (!opsByDay.has(dayKey)) opsByDay.set(dayKey, []);
    opsByDay.get(dayKey)!.push({ assetId: o.assetId, delta });
  }

  // -----------------------------
  // 3) lastKnown equity por asset: seed snapshot o fallback a netContrib (mark-to-model)
  // -----------------------------
  const lastKnown = new Map<number, number>();
  for (const assetId of assetIds) {
    const seedSnap = seedValueMap.get(assetId)?.value;
    const fallback = netContribByAsset.get(assetId) ?? 0; // consistente con tu lógica
    lastKnown.set(assetId, seedSnap ?? fallback);
  }

  // -----------------------------
  // 4) Construcción de puntos por día
  // -----------------------------
const points: Array<{
  date: string;
  totalCurrentValue: number;
  equity: number;
  netContributions: number;
}> = [];
  let cursor = new Date(from);

  while (cursor < toExclusive) {
    const dayKey = this.toDayKeyUTC(cursor);

    // actualiza contribuciones del día
    const dayOps = opsByDay.get(dayKey);
    if (dayOps) {
      for (const { assetId, delta } of dayOps) {
        netContribByAsset.set(assetId, (netContribByAsset.get(assetId) ?? 0) + delta);
      }
    }

    // actualiza equity por valoraciones del día
    const updates = valuationsByDay.get(dayKey);
    if (updates) {
      for (const [assetId, val] of updates.entries()) lastKnown.set(assetId, val);
    }

    // suma portfolio equity
    let equity = 0;
    for (const assetId of assetIds) equity += lastKnown.get(assetId) ?? 0;

    // suma portfolio net contributions
    let netContributions = 0;
    for (const assetId of assetIds) netContributions += netContribByAsset.get(assetId) ?? 0;

points.push({
  date: dayKey,
  totalCurrentValue: equity,  // ✅ compatibilidad con tu frontend actual
  equity,                     // ✅ nuevo nombre “pro”
  netContributions,           // ✅ para aportaciones
});
    cursor = this.addUtcDays(cursor, 1);
  }

  return { points };
}


  // -----------------------------
  // Operations (Investment-only)
  // -----------------------------
  // HARD RULE: cash siempre se elige; investment nunca (es única e implícita)

  // Deposit: cash -> investment (inflow)
  async depositAsset(userId: number, assetId: number, dto: any) {
    await this.assertAssetOwned(userId, assetId);

    const amount = this.parseAmount(dto.amount, 'amount');
    const fee = this.parseFee(dto.fee);
    const date = this.parseDate(dto.date);

    const fromWalletId = this.requireInt(dto.fromWalletId, 'fromWalletId');
    // valida que exista y sea cash
    await this.assertWalletKind(userId, fromWalletId, 'cash');
    const invWalletId = await this.getSingleInvestmentWallet(userId);

    const description = dto.description?.trim() || 'Deposit investment';

    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertCashSufficient(tx, userId, fromWalletId, amount);

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          type: 'transfer',
          amount,
          description,
          date,
          fromWalletId,
          toWalletId: invWalletId,
          investmentAssetId: assetId,
          active: true,
        },
      });

      const op = await tx.investmentOperation.create({
        data: {
          userId,
          assetId,
          type: 'transfer_in' as any,
          date,
          amount,
          fee,
          transactionId: createdTx.id,
          active: true,
        },
      });

      // solo cash sale (investment wallet balance se deriva del recálculo)
      await tx.wallet.update({
        where: { id: fromWalletId },
        data: { balance: { decrement: amount } },
      });

      return { transaction: createdTx, operation: op };
    });

    await this.recalcInvestmentWalletBalance(userId);
    return result;
  }

  // Withdraw: investment -> cash (outflow)
  async withdrawAsset(userId: number, assetId: number, dto: any) {
    await this.assertAssetOwned(userId, assetId);

    const amount = this.parseAmount(dto.amount, 'amount');
    const fee = this.parseFee(dto.fee);
    const date = this.parseDate(dto.date);

    const toWalletId = this.requireInt(dto.toWalletId, 'toWalletId');
    await this.assertWalletKind(userId, toWalletId, 'cash');
    const invWalletId = await this.getSingleInvestmentWallet(userId);

    const description = dto.description?.trim() || 'Withdraw investment';

    const result = await this.prisma.$transaction(async (tx) => {
      const createdTx = await tx.transaction.create({
        data: {
          userId,
          type: 'transfer',
          amount,
          description,
          date,
          fromWalletId: invWalletId,
          toWalletId,
          investmentAssetId: assetId,
          active: true,
        },
      });

      const op = await tx.investmentOperation.create({
        data: {
          userId,
          assetId,
          type: 'transfer_out' as any,
          date,
          amount,
          fee,
          transactionId: createdTx.id,
          active: true,
        },
      });

      // solo cash entra
      await tx.wallet.update({
        where: { id: toWalletId },
        data: { balance: { increment: amount } },
      });

      return { transaction: createdTx, operation: op };
    });

    await this.recalcInvestmentWalletBalance(userId);
    return result;
  }

  // BUY: cash -> investment (inflow), separado de deposit por tipo de operación
  async buyAsset(userId: number, assetId: number, dto: any) {
    await this.assertAssetOwned(userId, assetId);

    const amount = this.parseAmount(dto.amount, 'amount');
    const fee = this.parseFee(dto.fee);
    const date = this.parseDate(dto.date);

    const fromWalletId = this.requireInt(dto.fromWalletId, 'fromWalletId');
    await this.assertWalletKind(userId, fromWalletId, 'cash');
    const invWalletId = await this.getSingleInvestmentWallet(userId);

    const description = dto.description?.trim() || 'Buy asset';

    const result = await this.prisma.$transaction(async (tx) => {
      await this.assertCashSufficient(tx, userId, fromWalletId, amount);

      const createdTx = await tx.transaction.create({
        data: {
          userId,
          type: 'transfer',
          amount,
          description,
          date,
          fromWalletId,
          toWalletId: invWalletId,
          investmentAssetId: assetId,
          active: true,
        },
      });

      const op = await tx.investmentOperation.create({
        data: {
          userId,
          assetId,
          type: 'buy' as any,
          date,
          amount,
          fee,
          transactionId: createdTx.id,
          active: true,
        },
      });

      // solo cash sale
      await tx.wallet.update({
        where: { id: fromWalletId },
        data: { balance: { decrement: amount } },
      });

      return { transaction: createdTx, operation: op };
    });

    await this.recalcInvestmentWalletBalance(userId);
    return result;
  }

  // SELL: investment -> cash (outflow), amount = cash NETO recibido
  async sellAsset(userId: number, assetId: number, dto: any) {
    await this.assertAssetOwned(userId, assetId);

    const amount = this.parseAmount(dto.amount, 'amount');
    const fee = this.parseFee(dto.fee);
    const date = this.parseDate(dto.date);

    const toWalletId = this.requireInt(dto.toWalletId, 'toWalletId');
    await this.assertWalletKind(userId, toWalletId, 'cash');
    const invWalletId = await this.getSingleInvestmentWallet(userId);

    const description = dto.description?.trim() || 'Sell investment';

    const result = await this.prisma.$transaction(async (tx) => {
      const createdTx = await tx.transaction.create({
        data: {
          userId,
          type: 'transfer',
          amount,
          description,
          date,
          fromWalletId: invWalletId,
          toWalletId,
          investmentAssetId: assetId,
          active: true,
        },
      });

      const op = await tx.investmentOperation.create({
        data: {
          userId,
          assetId,
          type: 'sell' as any,
          date,
          amount,
          fee,
          transactionId: createdTx.id,
          active: true,
        },
      });

      // solo cash entra
      await tx.wallet.update({
        where: { id: toWalletId },
        data: { balance: { increment: amount } },
      });

      return { transaction: createdTx, operation: op };
    });

    await this.recalcInvestmentWalletBalance(userId);
    return result;
  }

  // Swap: asset A -> asset B (sin wallets en v1)
  async swapAssets(userId: number, dto: any) {
    const fromAssetId = this.requireInt(dto.fromAssetId, 'fromAssetId');
    const toAssetId = this.requireInt(dto.toAssetId, 'toAssetId');

    if (fromAssetId === toAssetId) {
      throw new BadRequestException('fromAssetId and toAssetId must be different');
    }

    await this.assertAssetOwned(userId, fromAssetId);
    await this.assertAssetOwned(userId, toAssetId);

    const amountOut = this.parseAmount(dto.amountOut, 'amountOut');
    const amountIn = Number(dto.amountIn ?? dto.amountOut);
    if (!Number.isFinite(amountIn) || amountIn <= 0) throw new BadRequestException('Invalid amountIn');

    const fee = this.parseFee(dto.fee);
    const date = this.parseDate(dto.date);

    const swapGroupId =
      (dto.swapGroupId && String(dto.swapGroupId).trim()) ||
      `swap_${userId}_${Date.now()}_${Math.random().toString(16).slice(2)}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const outOp = await tx.investmentOperation.create({
        data: {
          userId,
          assetId: fromAssetId,
          type: 'swap_out' as any,
          date,
          amount: amountOut,
          fee,
          swapGroupId,
          active: true,
        },
      });

      const inOp = await tx.investmentOperation.create({
        data: {
          userId,
          assetId: toAssetId,
          type: 'swap_in' as any,
          date,
          amount: amountIn,
          fee: 0,
          swapGroupId,
          active: true,
        },
      });

      return { swapGroupId, outOperation: outOp, inOperation: inOp };
    });

    await this.recalcInvestmentWalletBalance(userId);
    return result;
  }

  async deleteSwap(userId: number, swapGroupId: string) {
    const sg = (swapGroupId ?? '').trim();
    if (!sg) throw new BadRequestException('swapGroupId is required');

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

    await this.prisma.investmentOperation.updateMany({
      where: { userId, swapGroupId: sg, type: { in: ['swap_in', 'swap_out'] as any } },
      data: { active: false },
    });

    await this.recalcInvestmentWalletBalance(userId);
    return { swapGroupId: sg, deletedCount: ops.length };
  }

  // Public hook para recalcular (usado por otros servicios si lo necesitas)
  async recalcInvestmentWallet(userId: number) {
    await this.recalcInvestmentWalletBalance(userId);
  }

  async listOperations(userId: number, assetId: number, active?: boolean) {
  // Opcional: valida que el asset pertenezca al user para evitar leaks por id
  const asset = await this.prisma.investmentAsset.findFirst({
    where: { id: assetId, userId, active: true },
    select: { id: true },
  });
  if (!asset) {
    throw new BadRequestException('Asset no encontrado');
  }

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

}
