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
   * balance = suma del último snapshot de cada asset (fallback: initialInvested)
   *
   * Se ejecuta tras crear/editar/borrar valuations.
   */
  private async recalcInvestmentWalletBalance(userId: number) {
    // 1) wallet de inversión (asumimos 1 por usuario)
    const investmentWallet = await this.prisma.wallet.findFirst({
      where: { userId, active: true, kind: 'investment' as any },
      select: { id: true },
    });

    // Si no existe, no hacemos nada
    if (!investmentWallet) return;

    // 2) assets activos
    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true },
      select: { id: true, initialInvested: true },
    });

    if (assets.length === 0) {
      await this.prisma.wallet.update({
        where: { id: investmentWallet.id },
        data: { balance: 0 },
      });
      return;
    }

    const assetIds = assets.map(a => a.id);

    // 3) últimas valuations por asset
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
          select: { assetId: true, value: true },
        })
      : [];

    const snapshotMap = new Map<number, number>();
    for (const s of latestSnapshots) snapshotMap.set(s.assetId, s.value);

    // 4) suma de currentValue (fallback = initialInvested)
    let totalCurrentValue = 0;
    for (const a of assets) {
      const snapValue = snapshotMap.get(a.id);
      const fallback = a.initialInvested ?? 0;
      totalCurrentValue += snapValue ?? fallback;
    }

    // 5) actualizar balance
    await this.prisma.wallet.update({
      where: { id: investmentWallet.id },
      data: { balance: totalCurrentValue },
    });
  }

  // -----------------------------
  // Assets
  // -----------------------------
  async createAsset(userId: number, dto: CreateInvestmentAssetDto) {
    const currency = dto.currency ?? 'EUR';

    const created = await this.prisma.investmentAsset.create({
      data: {
        userId,
        name: dto.name.trim(),
        symbol: dto.symbol?.trim(),
        type: dto.type ?? 'custom',
        currency,
        initialInvested: dto.initialInvested ?? 0, // aportado previo
      },
    });

    // Opcional: si quieres que al crear un asset sin valuations se refleje en wallet
    // await this.recalcInvestmentWalletBalance(userId);

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

    const updated = await this.prisma.investmentAsset.update({
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

    // Si initialInvested cambia y no hay valuations, afectará al fallback.
    // Puedes recalcular para mantener wallet alineada.
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

    const currency = dto.currency ?? 'EUR';

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

    // ✅ clave: al crear una valuation, recalcular el balance de la wallet de inversión
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

  async updateValuation(
    userId: number,
    id: number,
    dto: UpdateInvestmentValuationDto,
  ) {
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
        currency: dto.currency,
      },
    });

    // ✅ recalcular wallet inversión
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

    // ✅ recalcular wallet inversión
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
