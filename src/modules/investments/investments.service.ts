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

  // -----------------------------
  // Assets
  // -----------------------------
  async createAsset(userId: number, dto: CreateInvestmentAssetDto) {
    const currency = dto.currency ?? 'EUR';

    return this.prisma.investmentAsset.create({
      data: {
        userId,
        name: dto.name.trim(),
        symbol: dto.symbol?.trim(),
        type: dto.type ?? 'custom',
        currency,
        initialInvested: dto.initialInvested ?? 0, // aportado previo
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
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id, userId, active: true },
    });
    if (!asset) throw new NotFoundException('Investment asset not found');
    return asset;
  }

  async updateAsset(userId: number, id: number, dto: UpdateInvestmentAssetDto) {
    await this.getAsset(userId, id);

    return this.prisma.investmentAsset.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        symbol: dto.symbol?.trim(),
        type: dto.type,
        currency: dto.currency,
        // ✅ IMPORTANT: no resetees a 0 si no viene
        initialInvested: dto.initialInvested,
      },
    });
  }

  async deleteAsset(userId: number, id: number) {
    await this.getAsset(userId, id);

    return this.prisma.investmentAsset.update({
      where: { id },
      data: { active: false },
    });
  }

  // -----------------------------
  // Valuations
  // -----------------------------
  async createValuation(userId: number, dto: CreateInvestmentValuationDto) {
    await this.assertAssetOwned(userId, dto.assetId);

    const date = new Date(dto.date);
    if (isNaN(date.getTime())) throw new BadRequestException('Invalid date');

    const currency = dto.currency ?? 'EUR';

    return this.prisma.investmentValuationSnapshot.upsert({
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

    return this.prisma.investmentValuationSnapshot.update({
      where: { id },
      data: {
        assetId: dto.assetId,
        date: dto.date ? new Date(dto.date) : undefined,
        value: dto.value,
        currency: dto.currency,
      },
    });
  }

  async deleteValuation(userId: number, id: number) {
    const existing = await this.prisma.investmentValuationSnapshot.findFirst({
      where: { id, userId, active: true },
    });
    if (!existing) throw new NotFoundException('Valuation snapshot not found');

    return this.prisma.investmentValuationSnapshot.update({
      where: { id },
      data: { active: false },
    });
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
        symbol: true,
        type: true,
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

    // SOLO transfers hacia wallets de inversión
    const investedByAsset = await this.prisma.transaction.groupBy({
      by: ['investmentAssetId'],
      where: {
        userId,
        active: true,
        type: 'transfer',
        investmentAssetId: { in: assetIds },
        toWalletId: { not: null },
        toWallet: { kind: 'investment' },
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

    const latestSnapshots = await this.prisma.investmentValuationSnapshot.findMany({
      where: {
        userId,
        active: true,
        OR: latestDates
          .filter(r => r._max.date)
          .map(r => ({ assetId: r.assetId, date: r._max.date! })),
      },
    });

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
        symbol: a.symbol,
        type: a.type,
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
