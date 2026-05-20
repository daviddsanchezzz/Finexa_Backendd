import { Injectable, Logger } from '@nestjs/common';
import { InvestmentAssetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { computeExposureBuckets } from './investment-exposure.utils';
import { FundMetadataResolverService } from './fund-metadata-resolver.service';
import { normalizeCountry, normalizeSector, normalizeWeightMap } from './fund-metadata.utils';
import { ManualAssetMetadataDto } from './dto/manual-asset-metadata.dto';
import { UpsertCompositionDto } from './dto/upsert-composition.dto';
import { UpsertInvestmentTargetsDto } from './dto/upsert-investment-targets.dto';
import { RebalancePreviewDto } from './dto/rebalance-preview.dto';
import { ContributionPreviewDto } from './dto/contribution-preview.dto';
import { BadRequestException } from '@nestjs/common';

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
        abbreviation: true,
        type: true,
        initialInvested: true,
      },
    });

    const assetIds = assets.map((a) => a.id);
    if (!assetIds.length) return [] as Array<{ id: number; name: string; abbreviation: string | null; type: InvestmentAssetType; currentValue: number }>;

    const bookIn = new Set(['transfer_in', 'buy', 'swap_in']);
    const bookOut = new Set(['transfer_out', 'sell', 'swap_out']);

    const [ops, latestDates] = await Promise.all([
      this.prisma.investmentOperation.findMany({
        where: { userId, active: true, assetId: { in: assetIds } },
        select: { assetId: true, type: true, amount: true },
      }),
      this.prisma.investmentValuationSnapshot.groupBy({
        by: ['assetId'],
        where: { userId, active: true, assetId: { in: assetIds } },
        _max: { date: true },
      }),
    ]);

    const byAsset = new Map<number, { in: number; out: number }>();
    for (const op of ops) {
      const prev = byAsset.get(op.assetId) ?? { in: 0, out: 0 };
      const t = String(op.type);
      const amount = Number(op.amount ?? 0);
      if (bookIn.has(t)) prev.in += amount;
      if (bookOut.has(t)) prev.out += amount;
      byAsset.set(op.assetId, prev);
    }

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
        abbreviation: a.abbreviation ?? null,
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

    const [meta, regions, sectors, holdings] = await Promise.all([
      this.prisma.assetMetadata.findUnique({ where: { assetId } }),
      this.prisma.investmentAssetRegion.findMany({ where: { assetId }, orderBy: { pct: 'desc' } }),
      this.prisma.investmentAssetSector.findMany({ where: { assetId }, orderBy: { pct: 'desc' } }),
      this.prisma.investmentAssetHolding.findMany({ where: { assetId }, orderBy: { sortOrder: 'asc' } }),
    ]);

    return {
      asset,
      metadata: meta,
      composition: { regions, sectors, holdings },
    };
  }

  // ── Normalized composition ───────────────────────────────────────────────

  async getComposition(userId: number, assetId: number) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
    });
    if (!asset) return null;

    const [regions, sectors, holdings] = await Promise.all([
      this.prisma.investmentAssetRegion.findMany({ where: { assetId }, orderBy: { pct: 'desc' } }),
      this.prisma.investmentAssetSector.findMany({ where: { assetId }, orderBy: { pct: 'desc' } }),
      this.prisma.investmentAssetHolding.findMany({ where: { assetId }, orderBy: { sortOrder: 'asc' } }),
    ]);

    // If no normalized data yet, fall back to JSON blobs for backwards compat
    if (!regions.length && !sectors.length && !holdings.length) {
      const meta = await this.prisma.assetMetadata.findUnique({ where: { assetId } });
      if (meta) {
        const fallbackRegions = meta.countriesJson
          ? Object.entries(meta.countriesJson as Record<string, number>).map(([country, pct]) => ({ country, pct }))
          : [];
        const fallbackSectors = meta.sectorsJson
          ? Object.entries(meta.sectorsJson as Record<string, number>).map(([sector, pct]) => ({ sector, pct }))
          : [];
        const fallbackHoldings = Array.isArray(meta.topHoldingsJson) ? meta.topHoldingsJson : [];
        return { regions: fallbackRegions, sectors: fallbackSectors, holdings: fallbackHoldings, source: 'json_fallback' };
      }
    }

    return { regions, sectors, holdings };
  }

  async upsertComposition(userId: number, assetId: number, dto: UpsertCompositionDto) {
    const asset = await this.prisma.investmentAsset.findFirst({
      where: { id: assetId, userId, active: true },
    });
    if (!asset) return null;

    await this.prisma.$transaction(async (tx) => {
      if (dto.regions !== undefined) {
        await tx.investmentAssetRegion.deleteMany({ where: { assetId } });
        if (dto.regions.length) {
          await tx.investmentAssetRegion.createMany({
            data: dto.regions.map((r) => ({ assetId, country: r.country, pct: r.pct })),
          });
        }
      }

      if (dto.sectors !== undefined) {
        await tx.investmentAssetSector.deleteMany({ where: { assetId } });
        if (dto.sectors.length) {
          await tx.investmentAssetSector.createMany({
            data: dto.sectors.map((s) => ({ assetId, sector: s.sector, pct: s.pct })),
          });
        }
      }

      if (dto.holdings !== undefined) {
        await tx.investmentAssetHolding.deleteMany({ where: { assetId } });
        if (dto.holdings.length) {
          await tx.investmentAssetHolding.createMany({
            data: dto.holdings.map((h, i) => ({
              assetId,
              name: h.name,
              ticker: h.ticker ?? null,
              weight: h.weight,
              sortOrder: h.sortOrder ?? i,
            })),
          });
        }
      }
    });

    return this.getComposition(userId, assetId);
  }

  // ── Exposure (cross-asset analytics) ─────────────────────────────────────

  async getExposure(userId: number) {
    const assets = await this.getAssetsWithCurrentValue(userId);
    if (!assets.length) {
      return { countries: [], sectors: [], indirectHoldings: [], totalPortfolioValue: 0 };
    }

    // Include crypto composition in exposure buckets; only cash is excluded.
    const eligibleAssets = assets.filter((a) => a.type !== 'cash');
    if (!eligibleAssets.length) {
      return { countries: [], sectors: [], indirectHoldings: [], totalPortfolioValue: 0 };
    }

    const eligibleIds = eligibleAssets.map((a) => a.id);

    // Fetch normalized tables + JSON fallback in parallel
    const [assetRegions, assetSectors, assetHoldings, metas] = await Promise.all([
      this.prisma.investmentAssetRegion.findMany({ where: { assetId: { in: eligibleIds } } }),
      this.prisma.investmentAssetSector.findMany({ where: { assetId: { in: eligibleIds } } }),
      this.prisma.investmentAssetHolding.findMany({ where: { assetId: { in: eligibleIds } } }),
      this.prisma.assetMetadata.findMany({
        where: { assetId: { in: eligibleIds } },
        select: { assetId: true, countriesJson: true, sectorsJson: true, topHoldingsJson: true },
      }),
    ]);

    // Group normalized data by assetId
    const regionsByAsset = new Map<number, typeof assetRegions>();
    for (const r of assetRegions) {
      const prev = regionsByAsset.get(r.assetId) ?? [];
      regionsByAsset.set(r.assetId, [...prev, r]);
    }
    const sectorsByAsset = new Map<number, typeof assetSectors>();
    for (const s of assetSectors) {
      const prev = sectorsByAsset.get(s.assetId) ?? [];
      sectorsByAsset.set(s.assetId, [...prev, s]);
    }
    const holdingsByAsset = new Map<number, typeof assetHoldings>();
    for (const h of assetHoldings) {
      const prev = holdingsByAsset.get(h.assetId) ?? [];
      holdingsByAsset.set(h.assetId, [...prev, h]);
    }
    const metaByAsset = new Map(metas.map((m) => [m.assetId, m]));

    const rows = eligibleAssets.map((a) => {
      const regions = regionsByAsset.get(a.id) ?? [];
      const sectors = sectorsByAsset.get(a.id) ?? [];
      const holdings = holdingsByAsset.get(a.id) ?? [];
      const meta = metaByAsset.get(a.id);

      // Prefer normalized tables; fall back to JSON if no rows exist
      const countries: Record<string, number> | null =
        regions.length > 0
          ? Object.fromEntries(regions.map((r) => [r.country, Number(r.pct)]))
          : (meta?.countriesJson as Record<string, number> | null) ?? null;

      const sectorsMap: Record<string, number> | null =
        sectors.length > 0
          ? Object.fromEntries(sectors.map((s) => [s.sector, Number(s.pct)]))
          : (meta?.sectorsJson as Record<string, number> | null) ?? null;

      const topHoldings: any[] | null =
        holdings.length > 0
          ? holdings.map((h) => ({ name: h.name, ticker: h.ticker, weight: Number(h.weight) }))
          : (meta?.topHoldingsJson as any[] | null) ?? null;

      return { currentValue: a.currentValue, countries, sectors: sectorsMap, topHoldings };
    });

    return computeExposureBuckets(rows);
  }

  async listInvestmentTargets(userId: number) {
    const assets = await this.getAssetsWithCurrentValue(userId);
    const eligibleAssets = assets.filter((a) => a.type !== 'cash');
    const total = eligibleAssets.reduce((sum, a) => sum + Number(a.currentValue || 0), 0);

    const targetRows = await this.prisma.investmentTargetAllocation.findMany({
      where: { userId, active: true, assetId: { in: eligibleAssets.map((a) => a.id) } },
      select: { assetId: true, targetPct: true },
    });
    const byAsset = new Map<number, number>(
      targetRows.map((r) => [r.assetId, Number(r.targetPct || 0)]),
    );

    const sumTarget = targetRows.reduce((s, r) => s + Number(r.targetPct || 0), 0);

    return {
      totalCurrentValue: total,
      targetSumPct: sumTarget,
      items: eligibleAssets
        .map((a) => {
          const currentValue = Number(a.currentValue || 0);
          const actualPct = total > 0 ? (currentValue / total) * 100 : 0;
          const targetPct = byAsset.get(a.id) ?? 0;
          return {
            assetId: a.id,
            assetName: a.name,
            assetAbbreviation: a.abbreviation ?? null,
            assetType: a.type,
            currentValue,
            actualPct,
            targetPct,
            driftPct: actualPct - targetPct,
          };
        })
        .sort((x, y) => y.currentValue - x.currentValue),
    };
  }

  async upsertInvestmentTargets(userId: number, dto: UpsertInvestmentTargetsDto) {
    const items = Array.isArray(dto.items) ? dto.items : [];
    if (!items.length) throw new BadRequestException('items is required');

    const dedup = new Map<number, number>();
    for (const it of items) {
      const assetId = Number(it.assetId);
      const targetPct = Number(it.targetPct);
      if (!Number.isInteger(assetId)) throw new BadRequestException('Invalid assetId');
      if (!Number.isFinite(targetPct) || targetPct < 0 || targetPct > 100) {
        throw new BadRequestException('Invalid targetPct');
      }
      dedup.set(assetId, targetPct);
    }

    const assetIds = [...dedup.keys()];
    const owned = await this.prisma.investmentAsset.findMany({
      where: { userId, active: true, archived: false, type: { not: 'cash' }, id: { in: assetIds } },
      select: { id: true },
    });
    if (owned.length !== assetIds.length) {
      throw new BadRequestException('Some assets are invalid or not eligible');
    }

    const sum = [...dedup.values()].reduce((s, x) => s + Number(x || 0), 0);
    if (Math.abs(sum - 100) > 0.01) {
      throw new BadRequestException('Target allocation must sum exactly 100%');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.investmentTargetAllocation.updateMany({
        where: { userId },
        data: { active: false },
      });

      for (const [assetId, targetPct] of dedup.entries()) {
        await tx.investmentTargetAllocation.upsert({
          where: { userId_assetId: { userId, assetId } },
          update: { targetPct, active: true },
          create: { userId, assetId, targetPct, active: true },
        });
      }
    });

    return this.listInvestmentTargets(userId);
  }

  async previewRebalance(userId: number, dto: RebalancePreviewDto) {
    const minOperation = Math.max(0, Number(dto?.minOperation ?? 0));
    const target = await this.listInvestmentTargets(userId);
    if (!target.items.length) throw new BadRequestException('No eligible assets');
    if (Math.abs(Number(target.targetSumPct || 0) - 100) > 0.01) {
      throw new BadRequestException('Target allocation is not configured to 100%');
    }

    const total = Number(target.totalCurrentValue || 0);
    const rows = target.items.map((x) => {
      const targetValue = (total * Number(x.targetPct || 0)) / 100;
      const delta = targetValue - Number(x.currentValue || 0);
      return {
        assetId: x.assetId,
        assetName: x.assetName,
        currentValue: Number(x.currentValue || 0),
        targetValue,
        delta,
      };
    });

    const buys = rows
      .filter((r) => r.delta > minOperation)
      .map((r) => ({ assetId: r.assetId, assetName: r.assetName, amount: Number(r.delta.toFixed(2)) }));
    const sells = rows
      .filter((r) => r.delta < -minOperation)
      .map((r) => ({ assetId: r.assetId, assetName: r.assetName, amount: Number(Math.abs(r.delta).toFixed(2)) }));

    return {
      totalCurrentValue: total,
      minOperation,
      buys,
      sells,
      rows,
    };
  }

  async previewContribution(userId: number, dto: ContributionPreviewDto) {
    const amount = Number(dto?.amount || 0);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Invalid amount');
    const minOperation = Math.max(0, Number(dto?.minOperation ?? 0));

    const target = await this.listInvestmentTargets(userId);
    if (!target.items.length) throw new BadRequestException('No eligible assets');
    if (Math.abs(Number(target.targetSumPct || 0) - 100) > 0.01) {
      throw new BadRequestException('Target allocation is not configured to 100%');
    }

    const total = Number(target.totalCurrentValue || 0);
    const nextTotal = total + amount;
    const needs = target.items
      .map((x) => {
        const desiredAfter = (nextTotal * Number(x.targetPct || 0)) / 100;
        const need = Math.max(0, desiredAfter - Number(x.currentValue || 0));
        return { assetId: x.assetId, assetName: x.assetName, need };
      })
      .filter((x) => x.need > 0);

    const needSum = needs.reduce((s, x) => s + x.need, 0);
    const allocations = needs
      .map((n) => {
        const raw = needSum > 0 ? (amount * n.need) / needSum : 0;
        return { assetId: n.assetId, assetName: n.assetName, amount: Number(raw.toFixed(2)) };
      })
      .filter((x) => x.amount > minOperation);

    const assigned = allocations.reduce((s, x) => s + x.amount, 0);
    const remainder = Number((amount - assigned).toFixed(2));

    return {
      amount,
      minOperation,
      totalCurrentValue: total,
      totalAfterContribution: nextTotal,
      allocations,
      remainder,
    };
  }

  // ── Internal: write normalized tables from external sync results ──────────

  private async syncNormalizedComposition(
    assetId: number,
    countries: Record<string, number> | null,
    sectors: Record<string, number> | null,
    holdings: any[] | null,
  ) {
    const ops: any[] = [];

    if (countries && Object.keys(countries).length) {
      ops.push(this.prisma.investmentAssetRegion.deleteMany({ where: { assetId } }));
      ops.push(
        this.prisma.investmentAssetRegion.createMany({
          data: Object.entries(countries).map(([country, pct]) => ({ assetId, country, pct })),
        }),
      );
    }

    if (sectors && Object.keys(sectors).length) {
      ops.push(this.prisma.investmentAssetSector.deleteMany({ where: { assetId } }));
      ops.push(
        this.prisma.investmentAssetSector.createMany({
          data: Object.entries(sectors).map(([sector, pct]) => ({ assetId, sector, pct })),
        }),
      );
    }

    if (holdings && holdings.length) {
      ops.push(this.prisma.investmentAssetHolding.deleteMany({ where: { assetId } }));
      ops.push(
        this.prisma.investmentAssetHolding.createMany({
          data: holdings.map((h: any, i: number) => ({
            assetId,
            name: h.name,
            ticker: h.ticker ?? null,
            weight: Number(h.weight ?? 0),
            sortOrder: i,
          })),
        }),
      );
    }

    if (ops.length) {
      await this.prisma.$transaction(ops);
    }
  }

  // ── Sync metadata from external providers ─────────────────────────────────

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

    const saved = await this.prisma.assetMetadata.upsert({
      where: { assetId: asset.id },
      create: payload,
      update: payload,
    });

    // Also populate normalized tables so UI always reads from them
    await this.syncNormalizedComposition(
      asset.id,
      nextCountries ?? (existing?.countriesJson as Record<string, number> | null) ?? null,
      nextSectors ?? (existing?.sectorsJson as Record<string, number> | null) ?? null,
      nextHoldings ?? (existing?.topHoldingsJson as any[] | null) ?? null,
    );

    return saved;
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

    const saved = await this.prisma.assetMetadata.upsert({
      where: { assetId },
      create: payload,
      update: payload,
    });

    // Mirror to normalized tables
    await this.syncNormalizedComposition(
      assetId,
      dto.countries ?? null,
      dto.sectors ?? null,
      dto.topHoldings ?? null,
    );

    return saved;
  }
}
