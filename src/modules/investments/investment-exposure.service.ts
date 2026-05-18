import { Injectable, Logger } from '@nestjs/common';
import { InvestmentAssetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { FmpService } from './fmp.service';
import { computeExposureBuckets } from './investment-exposure.utils';

@Injectable()
export class InvestmentExposureService {
  private readonly logger = new Logger(InvestmentExposureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fmp: FmpService,
  ) {}

  private async getAssetsWithCurrentValue(userId: number) {
    const assets = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true, archived: false },
      select: {
        id: true,
        name: true,
        type: true,
        initialInvested: true,
      },
    });

    const assetIds = assets.map((a) => a.id);
    if (!assetIds.length) return [] as Array<{ id: number; name: string; type: InvestmentAssetType; currentValue: number }>;

    const ops = await this.prisma.investmentOperation.findMany({
      where: { userId, active: true, assetId: { in: assetIds } },
      select: { assetId: true, type: true, amount: true },
    });

    const bookIn = new Set(['transfer_in', 'buy', 'swap_in']);
    const bookOut = new Set(['transfer_out', 'sell', 'swap_out']);

    const byAsset = new Map<number, { in: number; out: number }>();
    for (const op of ops) {
      const prev = byAsset.get(op.assetId) ?? { in: 0, out: 0 };
      const t = String(op.type);
      const amount = Number(op.amount ?? 0);
      if (bookIn.has(t)) prev.in += amount;
      if (bookOut.has(t)) prev.out += amount;
      byAsset.set(op.assetId, prev);
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

    const snapMap = new Map<number, { date: Date; value: number }>();
    for (const s of latestSnapshots) {
      const prev = snapMap.get(s.assetId);
      if (!prev || s.date > prev.date) snapMap.set(s.assetId, { date: s.date, value: Number(s.value ?? 0) });
    }

    return assets.map((a) => {
      const book = Number(a.initialInvested ?? 0) + (byAsset.get(a.id)?.in ?? 0) - (byAsset.get(a.id)?.out ?? 0);
      const currentValue = snapMap.get(a.id)?.value ?? book;
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        currentValue,
      };
    });
  }

  async getAssetMetadata(userId: number, assetId: number) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
      select: { id: true, type: true, name: true },
    });
    if (!asset) return null;

    const meta = await this.prisma.assetMetadata.findUnique({ where: { assetId } });
    return {
      asset,
      metadata: meta,
    };
  }

  async getExposure(userId: number) {
    const assets = await this.getAssetsWithCurrentValue(userId);
    if (!assets.length) {
      return { countries: [], sectors: [], indirectHoldings: [], totalPortfolioValue: 0 };
    }

    const metas = await this.prisma.assetMetadata.findMany({
      where: { assetId: { in: assets.map((a) => a.id) } },
      select: { assetId: true, countriesJson: true, sectorsJson: true, topHoldingsJson: true },
    });
    const metaByAsset = new Map(metas.map((m) => [m.assetId, m]));

    const rows = assets.map((a) => {
      const m = metaByAsset.get(a.id);
      return {
        currentValue: a.currentValue,
        countries: (m?.countriesJson as Record<string, number> | null) ?? null,
        sectors: (m?.sectorsJson as Record<string, number> | null) ?? null,
        topHoldings: (m?.topHoldingsJson as any[] | null) ?? null,
      };
    });

    return computeExposureBuckets(rows);
  }

  private inferCryptoCategory(assetName: string) {
    const n = assetName.toLowerCase();
    if (n.includes('bitcoin') || n.includes('btc')) return 'Store of Value';
    if (n.includes('ethereum') || n.includes('eth')) return 'Smart Contracts';
    if (n.includes('solana') || n.includes('ada') || n.includes('avalanche')) return 'Layer 1';
    if (n.includes('usd') || n.includes('usdt') || n.includes('usdc')) return 'Stablecoin';
    return null;
  }

  async syncMetadataForAsset(userId: number, assetId: number) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
      select: { id: true, name: true, type: true, symbol: true, identificator: true, currency: true },
    });

    if (!asset) return null;

    if (asset.type === 'crypto') {
      const payload: Prisma.AssetMetadataUncheckedCreateInput = {
        assetId: asset.id,
        isin: asset.identificator ?? null,
        provider: 'manual',
        currency: asset.currency,
        cryptoCategory: this.inferCryptoCategory(asset.name),
        source: 'crypto-inferred',
        syncedAt: new Date(),
        lastError: null,
      };
      return this.prisma.assetMetadata.upsert({
        where: { assetId: asset.id },
        create: payload,
        update: payload,
      });
    }

    if (!['fund', 'etf'].includes(asset.type)) return null;

    const existing = await this.prisma.assetMetadata.findUnique({ where: { assetId: asset.id } });

    if (!this.fmp.isConfigured()) {
      const err = 'FMP_API_KEY is not configured';
      await this.prisma.assetMetadata.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          isin: asset.identificator ?? null,
          provider: 'fmp',
          currency: asset.currency,
          lastError: err,
          source: 'fmp',
        },
        update: { lastError: err, source: 'fmp' },
      });
      return existing;
    }

    try {
      const resolvedSymbol = existing?.fmpSymbol || (await this.fmp.resolveSymbol({
        isin: existing?.isin || asset.identificator,
        name: asset.name,
      }));

      if (!resolvedSymbol) {
        const msg = 'Symbol not found in FMP';
        await this.prisma.assetMetadata.upsert({
          where: { assetId: asset.id },
          create: {
            assetId: asset.id,
            isin: existing?.isin || asset.identificator,
            provider: 'fmp',
            currency: asset.currency,
            lastError: msg,
            source: 'fmp',
          },
          update: { lastError: msg, source: 'fmp' },
        });
        return existing;
      }

      const [info, countryRows, sectorRows, holdingRows] = await Promise.all([
        this.fmp.etfInfo(resolvedSymbol),
        this.fmp.countryWeightings(resolvedSymbol),
        this.fmp.sectorWeightings(resolvedSymbol),
        this.fmp.holdings(resolvedSymbol),
      ]);

      const countries = this.fmp.normalizeWeightMap(countryRows, ['country', 'name']);
      const sectors = this.fmp.normalizeWeightMap(sectorRows, ['sector', 'name']);
      const topHoldings = this.fmp.normalizeHoldings(holdingRows).slice(0, 5);
      const infoRow = Array.isArray(info) ? info[0] : null;

      const payload: Prisma.AssetMetadataUncheckedCreateInput = {
        assetId: asset.id,
        isin: existing?.isin || asset.identificator || null,
        fmpSymbol: resolvedSymbol,
        provider: 'fmp',
        currency: String(infoRow?.currency ?? asset.currency ?? '').toUpperCase() || asset.currency,
        countriesJson: countries,
        sectorsJson: sectors,
        topHoldingsJson: topHoldings,
        source: 'fmp',
        syncedAt: new Date(),
        lastError: null,
      };

      return this.prisma.assetMetadata.upsert({
        where: { assetId: asset.id },
        create: payload,
        update: payload,
      });
    } catch (e: any) {
      const message = String(e?.response?.data?.message || e?.message || e);
      this.logger.warn(`metadata sync failed asset=${asset.id}: ${message}`);
      await this.prisma.assetMetadata.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          isin: existing?.isin || asset.identificator || null,
          provider: 'fmp',
          currency: asset.currency,
          source: 'fmp',
          lastError: message,
        },
        update: { lastError: message, source: 'fmp' },
      });
      return existing;
    }
  }

  async syncMetadataForAllUsers() {
    const assets = await this.prisma.investmentAsset.findMany({
      where: {
        active: true,
        archived: false,
        type: { in: ['fund', 'etf', 'crypto'] },
      },
      select: { id: true, userId: true },
    });

    for (const a of assets) {
      try {
        await this.syncMetadataForAsset(a.userId, a.id);
      } catch (e: any) {
        this.logger.warn(`syncMetadataForAllUsers failed asset=${a.id}: ${e?.message ?? e}`);
      }
    }

    return { processed: assets.length };
  }
}
