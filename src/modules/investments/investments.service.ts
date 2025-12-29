import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CreateInvestmentAssetDto } from './dto/create-investment-asset.dto';
import { UpdateInvestmentAssetDto } from './dto/update-investment-asset.dto';
import { CreateInvestmentValuationDto } from './dto/create-valuation.dto';
import { UpdateInvestmentValuationDto } from './dto/update-valuation.dto';

@Injectable()
export class InvestmentsService {
  constructor(private prisma: PrismaService) {}

  // -----------------------------
  // Helpers
  // -----------------------------
  private async assertAssetOwned(userId: number, assetId: number) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
      select: { id: true },
    });

    if (!asset) throw new NotFoundException('Investment asset not found');
    return true;
  }

  /**
   * Recalcula el balance de la wallet de inversión (única) del usuario:
   * balance = suma del último snapshot de cada asset (fallback: invested)
   *
   * Se ejecuta tras crear/editar/borrar valuations.
   */
  private async recalcInvestmentWalletBalance(userId: number) {
    // 1) wallets de inversión (en summary usas findMany, así soportas 1 o varias)
    const investmentWallets = await this.prisma.wallet.findMany({
      where: { userId, active: true, kind: 'investment' as any },
      select: { id: true },
    });

    if (investmentWallets.length === 0) return;

    // Si tu modelo es "solo 1 wallet de inversión", actualizamos la primera (como antes)
    const investmentWalletId = investmentWallets[0].id;
    const investmentWalletIds = investmentWallets.map(w => w.id);

    // 2) assets activos
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

    const assetIds = assets.map(a => a.id);

    // 3) transfers entrantes a wallet(s) de inversión por asset (MISMA LOGICA QUE getSummary)
    const investedByAsset = await this.prisma.transaction.groupBy({
      by: ['investmentAssetId'],
      where: {
        userId,
        active: true,
        type: 'transfer',
        investmentAssetId: { in: assetIds },
        toWalletId: { in: investmentWalletIds },
      },
      _sum: { amount: true },
    });

    const investedTransfersMap = new Map<number, number>();
    for (const row of investedByAsset) {
      const id = row.investmentAssetId!;
      investedTransfersMap.set(id, row._sum.amount ?? 0);
    }

    // 4) últimas valuations por asset (MISMA IDEA QUE getSummary)
    const latestDates = await this.prisma.investmentValuationSnapshot.groupBy({
      by: ['assetId'],
      where: { userId, active: true, assetId: { in: assetIds } },
      _max: { date: true },
    });

    const latestPairs = latestDates
      .filter(r => r._max.date)
      .map(r => ({ assetId: r.assetId, date: r._max.date! }));

    const latestSnapshots = latestPairs.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: { userId, active: true, OR: latestPairs },
          select: { assetId: true, value: true, date: true },
        })
      : [];

    // Si por cualquier motivo vienen varias filas por el mismo assetId, nos quedamos con la más reciente
    const snapshotMap = new Map<number, { value: number; date: Date }>();
    for (const s of latestSnapshots) {
      const prev = snapshotMap.get(s.assetId);
      if (!prev || s.date > prev.date) snapshotMap.set(s.assetId, { value: s.value, date: s.date });
    }

    // 5) suma de currentValue con fallback = invested (MISMA LOGICA QUE getSummary)
    let totalCurrentValue = 0;

    for (const a of assets) {
      const transfers = investedTransfersMap.get(a.id) ?? 0;
      const invested = (a.initialInvested ?? 0) + transfers;

      const snap = snapshotMap.get(a.id);
      const currentValue = snap?.value ?? invested;

      totalCurrentValue += currentValue;
    }

    // 6) actualizar balance de la wallet de inversión
    await this.prisma.wallet.update({
      where: { id: investmentWalletId },
      data: { balance: totalCurrentValue },
    });
  }

  // -----------------------------
  // Assets
  // -----------------------------
  async createAsset(userId: number, dto: CreateInvestmentAssetDto) {
    const name = (dto.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');

    const currency = (dto.currency ?? 'EUR').trim().toUpperCase();

    const created = await this.prisma.investmentAsset.create({
      data: {
        userId,
        name,
        description: dto.description?.trim() || null, // ✅ NUEVO
        type: dto.type ?? 'custom',
        riskType: (dto as any).riskType, // ✅ si ya lo añadiste al DTO/modelo
        currency,
        initialInvested: dto.initialInvested ?? 0, // aportado previo
      },
    });

    return created;
  }

  async listAssets(userId: number) {
    return this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      orderBy: { name: 'asc' },
    });
  }

  async getAsset(userId: number, id: number) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id, userId, active: true },
    });
    if (!asset) throw new NotFoundException('Investment asset not found');
    return asset;
  }

  async updateAsset(userId: number, id: number, dto: UpdateInvestmentAssetDto) {
    await this.getAsset(userId, id);

    const data: any = {
      name: dto.name?.trim(),
      type: dto.type,
      riskType: (dto as any).riskType, // ✅ si ya lo añadiste al DTO/modelo
      currency: dto.currency?.trim()?.toUpperCase(),
      // ✅ IMPORTANT: no resetees a 0 si no viene
      initialInvested: dto.initialInvested,
    };

    // ✅ description: permite borrar enviando "" o null
    if ('description' in (dto as any)) {
      const raw = (dto as any).description;
      data.description = raw && String(raw).trim() ? String(raw).trim() : null;
    }

    // Limpieza: Prisma ignora undefined, pero evitamos setear name a "" si viene vacío
    if (data.name === '') throw new BadRequestException('Name cannot be empty');
    if (data.currency === '') data.currency = undefined;

    const updated = await this.prisma.investmentAsset.update({
      where: { id },
      data,
    });

    // Si initialInvested cambia y no hay valuations, afectará al fallback.
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
  // Valuations
  // -----------------------------
  async createValuation(userId: number, dto: CreateInvestmentValuationDto) {
    await this.assertAssetOwned(userId, dto.assetId);

    const date = new Date(dto.date);
    if (isNaN(date.getTime())) throw new BadRequestException('Invalid date');

    const currency = (dto.currency ?? 'EUR').trim().toUpperCase();

    const valuation = await this.prisma.investmentValuationSnapshot.upsert({
      where: {
        userId_assetId_date: {
          userId,
          assetId: dto.assetId,
          date,
        },
      },
      update: {
        value: dto.value,
        currency,
        active: true,
      },
      create: {
        userId,
        assetId: dto.assetId,
        date,
        value: dto.value,
        currency,
      },
    });

    await this.recalcInvestmentWalletBalance(userId);

    return valuation;
  }

  async listValuations(userId: number, assetId?: number) {
    if (assetId) await this.assertAssetOwned(userId, assetId);

    return this.prisma.investmentValuationSnapshot.findMany({
      where: {
        userId,
        active: true,
        ...(assetId ? { assetId } : {}),
      },
      orderBy: { date: 'asc' },
    });
  }

  async updateValuation(userId: number, id: number, dto: UpdateInvestmentValuationDto) {
    const existing = await this.prisma.investmentValuationSnapshot.findFirst({
      where: { id, userId, active: true },
    });
    if (!existing) throw new NotFoundException('Valuation snapshot not found');

    if (dto.assetId) await this.assertAssetOwned(userId, dto.assetId);

    const updated = await this.prisma.investmentValuationSnapshot.update({
      where: { id },
      data: {
        assetId: dto.assetId,
        date: dto.date ? new Date(dto.date) : undefined,
        value: dto.value,
        currency: dto.currency?.trim()?.toUpperCase(),
      },
    });

    await this.recalcInvestmentWalletBalance(userId);

    return updated;
  }

  async deleteValuation(userId: number, id: number) {
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
  // invested = initialInvested + sum(transfers)
  // currentValue = last snapshot (fallback: invested)
  // pnl = currentValue - invested
  // -----------------------------
  async getSummary(userId: number) {
    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        description: true, // ✅ NUEVO
        type: true,
        riskType: true, // ✅ NUEVO (si existe en tu modelo)
        currency: true,
        initialInvested: true,
      },
    });

    const assetIds = assets.map(a => a.id);
    if (assetIds.length === 0) {
      return {
        totalInvested: 0,
        totalCurrentValue: 0,
        totalPnL: 0,
        assets: [],
      };
    }

    // ✅ IMPORTANTE: evitamos filtro relacional en groupBy (puede fallar según Prisma)
    const investmentWallets = await this.prisma.wallet.findMany({
      where: { userId, active: true, kind: 'investment' as any },
      select: { id: true },
    });
    const investmentWalletIds = investmentWallets.map(w => w.id);

    // SOLO transfers hacia wallets de inversión
    const investedByAsset = await this.prisma.transaction.groupBy({
      by: ['investmentAssetId'],
      where: {
        userId,
        active: true,
        type: 'transfer',
        investmentAssetId: { in: assetIds },
        toWalletId: { in: investmentWalletIds },
      },
      _sum: { amount: true },
    });

    const investedTransfersMap = new Map<number, number>();
    for (const row of investedByAsset) {
      const id = row.investmentAssetId!;
      investedTransfersMap.set(id, row._sum.amount ?? 0);
    }

    const latestDates = await this.prisma.investmentValuationSnapshot.groupBy({
      by: ['assetId'],
      where: { userId, active: true, assetId: { in: assetIds } },
      _max: { date: true },
    });

    const latestPairs = latestDates
      .filter(r => r._max.date)
      .map(r => ({ assetId: r.assetId, date: r._max.date! }));

    const latestSnapshots = latestPairs.length
      ? await this.prisma.investmentValuationSnapshot.findMany({
          where: {
            userId,
            active: true,
            OR: latestPairs,
          },
        })
      : [];

    const snapshotMap = new Map<number, { value: number; date: Date; currency: string }>();
    for (const s of latestSnapshots) {
      snapshotMap.set(s.assetId, { value: s.value, date: s.date, currency: s.currency });
    }

    const perAsset = assets.map(a => {
      const transfers = investedTransfersMap.get(a.id) ?? 0;
      const invested = (a.initialInvested ?? 0) + transfers;

      const snap = snapshotMap.get(a.id);
      const currentValue = snap?.value ?? invested;
      const pnl = currentValue - invested;

      return {
        id: a.id,
        name: a.name,
        description: a.description, // ✅ NUEVO
        type: a.type,
        riskType: (a as any).riskType, // ✅ NUEVO
        currency: a.currency,
        invested,
        currentValue,
        pnl,
        lastValuationDate: snap?.date ?? null,
      };
    });

    const totalInvested = perAsset.reduce((acc, x) => acc + x.invested, 0);
    const totalCurrentValue = perAsset.reduce((acc, x) => acc + x.currentValue, 0);
    const totalPnL = totalCurrentValue - totalInvested;

    return {
      totalInvested,
      totalCurrentValue,
      totalPnL,
      assets: perAsset,
    };
  }

  // -----------------------------
  // Serie temporal de snapshots para gráfica
  // -----------------------------
  async getAssetSeries(userId: number, assetId: number) {
    await this.assertAssetOwned(userId, assetId);

    return this.prisma.investmentValuationSnapshot.findMany({
      where: { userId, assetId, active: true },
      orderBy: { date: 'asc' },
      select: { date: true, value: true, currency: true },
    });
  }
}
