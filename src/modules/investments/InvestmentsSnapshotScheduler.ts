import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvestmentAssetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsService } from './investments.service';
import { PricesFetcherService } from './prices-fetcher.service';

const AUTO_PRICED_TYPES: InvestmentAssetType[] = [
  InvestmentAssetType.crypto,
  InvestmentAssetType.etf,
  InvestmentAssetType.stock,
  InvestmentAssetType.fund,
];

@Injectable()
export class InvestmentsSnapshotScheduler {
  private readonly logger = new Logger(InvestmentsSnapshotScheduler.name);

  constructor(
    private prisma: PrismaService,
    private investments: InvestmentsService,
    private pricesFetcher: PricesFetcherService,
  ) {}

  // Día 1 a las 00:05 (Europa/Madrid)
  @Cron('0 4 1 * *', { timeZone: 'Europe/Madrid' })
  async closePreviousMonth() {
    const users = await this.prisma.user.findMany({
      where: { active: true },
      select: { id: true },
    });

    const now = new Date();

    const prevMonthStartUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - 1,
      1,
      0, 0, 0, 0
    ));

    for (const u of users) {
      try {
        await this.investments.createMonthlySnapshot(u.id, prevMonthStartUTC, true);
      } catch (e: any) {
        this.logger.error(`Snapshot failed user=${u.id}: ${e?.message ?? e}`);
      }
    }
  }

  // Cada noche a las 23:00 (Europa/Madrid) — actualiza precios automáticamente
  @Cron('0 23 * * *', { timeZone: 'Europe/Madrid' })
  async fetchNightlyPrices() {
    this.logger.log('Nightly price fetch started');

    const assets = await this.prisma.investmentAsset.findMany({
      where: {
        active: true,
        identificator: { not: null },
        type: { in: AUTO_PRICED_TYPES },
      },
      select: {
        id: true,
        userId: true,
        type: true,
        identificator: true,
        quantity: true,
        currency: true,
      },
    });

    if (!assets.length) {
      this.logger.log('No assets with identificator, skipping');
      return;
    }

    // Batch CoinGecko call for all crypto
    const cryptoAssets = assets.filter((a) => a.type === InvestmentAssetType.crypto);
    const cryptoIds = [...new Set(cryptoAssets.map((a) => a.identificator!))];
    let cryptoPrices = new Map<string, number>();

    if (cryptoIds.length) {
      try {
        cryptoPrices = await this.pricesFetcher.fetchCryptoPrices(cryptoIds);
        this.logger.log(`CoinGecko: fetched ${cryptoPrices.size}/${cryptoIds.length} prices`);
      } catch (e: any) {
        this.logger.error(`CoinGecko fetch failed: ${e.message}`);
      }
    }

    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

    const affectedUsers = new Set<number>();

    for (const asset of assets) {
      try {
        let unitPrice: number | null = null;
        let priceCurrency = asset.currency ?? 'EUR';

        if (asset.type === InvestmentAssetType.crypto) {
          unitPrice = cryptoPrices.get(asset.identificator!) ?? null;
        } else {
          const result = await this.pricesFetcher.fetchEquityPriceByISIN(asset.identificator!);
          if (result) {
            unitPrice = result.price;
            priceCurrency = result.currency;
          }
        }

        if (unitPrice == null) {
          this.logger.warn(`No price for asset ${asset.id} (${asset.identificator})`);
          continue;
        }

        const qty = Number(asset.quantity ?? 0);
        if (qty <= 0) {
          this.logger.warn(`Asset ${asset.id} has quantity=${qty}, skipping`);
          continue;
        }

        const value = new Prisma.Decimal(unitPrice * qty);

        await this.prisma.$transaction(async (tx) => {
          await this.investments.upsertValuationSnapshotTx(tx, asset.userId, {
            assetId: asset.id,
            date: today,
            value,
            currency: priceCurrency,
            unitPrice: new Prisma.Decimal(unitPrice!),
            quantity: asset.quantity as Prisma.Decimal,
            source: 'cron',
          });
        });

        affectedUsers.add(asset.userId);
        this.logger.log(`asset=${asset.id} ${asset.identificator}: ${unitPrice} ${priceCurrency} × ${qty} = ${value}`);
      } catch (e: any) {
        this.logger.error(`Failed asset ${asset.id}: ${e.message}`);
      }
    }

    for (const userId of affectedUsers) {
      try {
        await this.investments.recalcInvestmentWalletBalance(userId);
      } catch (e: any) {
        this.logger.error(`Wallet recalc failed user=${userId}: ${e.message}`);
      }
    }

    this.logger.log(`Nightly fetch done — updated ${affectedUsers.size} user(s)`);
  }
}
