import { Injectable, Logger } from '@nestjs/common';
import { InvestmentAssetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { computeExposureBuckets } from './investment-exposure.utils';
import { FundMetadataResolverService } from './fund-metadata-resolver.service';
import { normalizeCountry, normalizeSector, normalizeWeightMap } from './fund-metadata.utils';
import { ManualAssetMetadataDto } from './dto/manual-asset-metadata.dto';

@Injectable()
export class InvestmentExposureService {
  private readonly logger = new Logger(InvestmentExposureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly resolver: FundMetadataResolverService,
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

    // For geographic/sector exposure, exclude asset classes not comparable by region/sector.
    const eligibleAssets = assets.filter((a) => a.type !== 'cash' && a.type !== 'crypto');
    if (!eligibleAssets.length) {
      return { countries: [], sectors: [], indirectHoldings: [], totalPortfolioValue: 0 };
    }

    const metas = await this.prisma.assetMetadata.findMany({
      where: { assetId: { in: eligibleAssets.map((a) => a.id) } },
      select: { assetId: true, countriesJson: true, sectorsJson: true, topHoldingsJson: true },
    });
    const metaByAsset = new Map(metas.map((m) => [m.assetId, m]));

    const rows = eligibleAssets.map((a) => {
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
      select: { id: true, name: true, type: true, provider: true, metadataUrl: true, identificator: true, currency: true },
    });

    if (!asset) return null;

    if (asset.type === 'crypto') {
      const payload: Prisma.AssetMetadataUncheckedCreateInput = {
        assetId: asset.id,
        isin: asset.identificator ?? null,
        provider: 'crypto',
        currency: asset.currency,
        cryptoCategory: this.inferCryptoCategory(asset.name),
        source: 'crypto-inferred',
        sourceUrl: null,
        asOfDate: null,
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
    const { result, errors } = await this.resolver.resolve({
      assetId: asset.id,
      name: asset.name,
      type: asset.type,
      provider: asset.provider,
      metadataUrl: asset.metadataUrl,
      identificator: existing?.isin || asset.identificator,
      existingSymbol: existing?.symbol || existing?.fmpSymbol || null,
    });

    if (!result) {
      const message = errors.join(' | ') || 'No provider returned metadata';
      this.logger.warn(`metadata sync failed asset=${asset.id}: ${message}`);
      await this.prisma.assetMetadata.upsert({
        where: { assetId: asset.id },
        create: {
          assetId: asset.id,
          isin: existing?.isin || asset.identificator || null,
          provider: existing?.provider || 'manual',
          currency: asset.currency,
          source: existing?.source || 'manual',
          lastError: message,
        },
        update: { lastError: message },
      });
      return existing;
    }

    const nextCountries = normalizeWeightMap(result.countries, normalizeCountry);
    const nextSectors = normalizeWeightMap(result.sectors, normalizeSector);
    const nextHoldings = result.topHoldings?.slice(0, 10) ?? null;

    const payload: Prisma.AssetMetadataUncheckedCreateInput = {
      assetId: asset.id,
      isin: existing?.isin || asset.identificator || null,
      symbol: result.symbol || existing?.symbol || null,
      provider: result.provider,
      currency: asset.currency,
      countriesJson: nextCountries ?? (existing?.countriesJson as any) ?? null,
      sectorsJson: nextSectors ?? (existing?.sectorsJson as any) ?? null,
      topHoldingsJson: nextHoldings ?? (existing?.topHoldingsJson as any) ?? null,
      source: result.source,
      sourceUrl: result.sourceUrl || null,
      asOfDate: result.asOfDate ? new Date(result.asOfDate) : (existing?.asOfDate ?? null),
      syncedAt: new Date(),
      lastError: null,
    };

    return this.prisma.assetMetadata.upsert({
      where: { assetId: asset.id },
      create: payload,
      update: payload,
    });
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

  async syncMetadataForUser(userId: number) {
    const assets = await this.prisma.investmentAsset.findMany({
      where: {
        userId,
        active: true,
        archived: false,
        type: { in: ['fund', 'etf', 'crypto'] },
      },
      select: { id: true },
    });

    for (const a of assets) {
      try {
        await this.syncMetadataForAsset(userId, a.id);
      } catch (e: any) {
        this.logger.warn(`syncMetadataForUser failed asset=${a.id}: ${e?.message ?? e}`);
      }
    }

    return { processed: assets.length };
  }

  async upsertManualMetadata(userId: number, assetId: number, dto: ManualAssetMetadataDto) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
      select: { id: true, identificator: true, currency: true },
    });
    if (!asset) return null;

    const existing = await this.prisma.assetMetadata.findUnique({ where: { assetId } });
    const payload: Prisma.AssetMetadataUncheckedCreateInput = {
      assetId,
      isin: existing?.isin || asset.identificator || null,
      symbol: existing?.symbol || null,
      provider: (dto.provider || 'manual').trim().toLowerCase(),
      currency: asset.currency,
      countriesJson: dto.countries ?? (existing?.countriesJson as any) ?? null,
      sectorsJson: dto.sectors ?? (existing?.sectorsJson as any) ?? null,
      topHoldingsJson: dto.topHoldings ?? (existing?.topHoldingsJson as any) ?? null,
      cryptoCategory: dto.cryptoCategory ?? existing?.cryptoCategory ?? null,
      source: (dto.source || 'manual').trim().toLowerCase(),
      sourceUrl: dto.sourceUrl ?? existing?.sourceUrl ?? null,
      asOfDate: dto.asOfDate ? new Date(dto.asOfDate) : (existing?.asOfDate ?? null),
      syncedAt: new Date(),
      lastError: null,
    };

    return this.prisma.assetMetadata.upsert({
      where: { assetId },
      create: payload,
      update: payload,
    });
  }
}
