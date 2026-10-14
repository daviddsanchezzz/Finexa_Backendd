import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvestmentAssetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsService } from './investments.service';
import { FtFundPrice, FtFundPriceService, ISIN_REGEX } from './ft-fund-price.service';

// Solo se sobrescriben snapshots que ya escribió una automatización: nunca los
// que el usuario introdujo a mano o importó desde Excel para esa misma fecha.
const OVERWRITABLE_SOURCES = ['cron', 'ft'];
const MAX_NAV_AGE_DAYS = 7;
const DELAY_BETWEEN_FETCHES_MS = 1500;

/**
 * Valora los fondos de inversión con el valor liquidativo publicado en
 * markets.ft.com (por ISIN). Sin respaldo: si FT falla para un fondo, ese fondo
 * no se actualiza ese día y se avisa en el log.
 *
 * El NAV de un fondo se publica a la mañana siguiente, así que el snapshot se
 * guarda con la fecha del NAV (la que dice FT), no con la de hoy. Se ejecuta
 * dos veces al día laborable; la segunda es un no-op si la primera ya lo dejó.
 *
 * Desactivado por defecto: FT_PRICES_CRON_ENABLED=true para activarlo.
 */
@Injectable()
export class FundPricesScheduler {
  private readonly logger = new Logger(FundPricesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly investments: InvestmentsService,
    private readonly ft: FtFundPriceService,
  ) {}

  @Cron('0 0 10,16 * * 1-5', { timeZone: 'Europe/Madrid' })
  async scheduledSync() {
    if (process.env.FT_PRICES_CRON_ENABLED !== 'true') return;
    await this.syncFundPrices();
  }

  async syncFundPrices(now: Date = new Date()) {
    const assets = await this.prisma.investmentAsset.findMany({
      where: {
        active: true,
        archived: false,
        type: InvestmentAssetType.fund,
        identificator: { not: null },
        quantity: { gt: new Prisma.Decimal(0) },
      },
      select: { id: true, userId: true, name: true, identificator: true, currency: true, quantity: true },
    });

    // Un fetch por (ISIN, divisa), aunque varios usuarios tengan el mismo fondo.
    const prices = new Map<string, FtFundPrice | null>();
    for (const a of assets) {
      const isin = a.identificator!.trim().toUpperCase();
      const key = `${isin}:${a.currency}`;
      if (prices.has(key)) continue;
      if (!ISIN_REGEX.test(isin)) {
        this.logger.warn(`Asset ${a.id} "${a.name}": identificator "${a.identificator}" no es un ISIN válido, se omite`);
        prices.set(key, null);
        continue;
      }
      try {
        const p = await this.ft.fetchFundPrice(isin, a.currency);
        const ageDays = (now.getTime() - p.navDate.getTime()) / 86_400_000;
        if (p.navDate.getTime() > now.getTime() || ageDays > MAX_NAV_AGE_DAYS) {
          throw new Error(`NAV date ${p.navDate.toISOString().slice(0, 10)} fuera de rango`);
        }
        prices.set(key, p);
      } catch (e: any) {
        this.logger.warn(`FT ${key} falló, no se actualiza: ${e?.message ?? e}`);
        prices.set(key, null);
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_FETCHES_MS));
    }

    const affectedUsers = new Set<number>();
    let written = 0;

    for (const a of assets) {
      const isin = a.identificator!.trim().toUpperCase();
      const p = prices.get(`${isin}:${a.currency}`);
      if (!p) continue;

      try {
        const existing = await this.prisma.investmentValuationSnapshot.findUnique({
          where: { userId_assetId_date: { userId: a.userId, assetId: a.id, date: p.navDate } },
          select: { source: true },
        });
        if (existing && !OVERWRITABLE_SOURCES.includes(existing.source)) {
          this.logger.log(`Asset ${a.id} ${p.navDate.toISOString().slice(0, 10)}: ya hay snapshot "${existing.source}", se respeta`);
          continue;
        }

        const unitPrice = new Prisma.Decimal(p.price);
        const quantity = new Prisma.Decimal(a.quantity as Prisma.Decimal.Value);
        await this.prisma.$transaction((tx) =>
          this.investments.upsertValuationSnapshotTx(tx, a.userId, {
            assetId: a.id,
            date: p.navDate,
            value: unitPrice.mul(quantity),
            currency: a.currency,
            unitPrice,
            quantity,
            source: 'ft',
          }),
        );
        affectedUsers.add(a.userId);
        written++;
      } catch (e: any) {
        this.logger.error(`Asset ${a.id} "${a.name}": error guardando snapshot: ${e?.message ?? e}`);
      }
    }

    for (const userId of affectedUsers) {
      try {
        await this.investments.recalcInvestmentWalletBalance(userId);
      } catch (e: any) {
        this.logger.error(`Wallet recalc failed user=${userId}: ${e?.message ?? e}`);
      }
    }

    this.logger.log(`FT fund prices: ${written}/${assets.length} snapshots escritos`);
    return { assets: assets.length, written };
  }
}
