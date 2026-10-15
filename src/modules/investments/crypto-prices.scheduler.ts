import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InvestmentAssetType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsService } from './investments.service';
import { CryptoClose, KrakenPriceService, TICKER_REGEX } from './kraken-price.service';

// Solo se sobrescriben snapshots que ya escribió una automatización: nunca los
// que el usuario introdujo a mano o importó desde Excel para esa misma fecha.
const OVERWRITABLE_SOURCES = ['cron', 'kraken'];
const MAX_CLOSE_AGE_DAYS = 4;
const DELAY_BETWEEN_FETCHES_MS = 1200;

/**
 * Valora las criptomonedas con el cierre diario (UTC) de Kraken. La cripto cotiza
 * 24/7, así que se guarda siempre el cierre del día anterior: es reproducible y
 * comparable día a día. Se ejecuta todos los días a las 00:10 UTC.
 *
 * Sin respaldo: si Kraken falla para una moneda, ese día no se escribe; al
 * siguiente día se vuelve a pedir y, como la vela diaria sigue disponible, se
 * rellena el último día cerrado.
 *
 * Activo por defecto; CRYPTO_PRICES_CRON_ENABLED=false lo apaga.
 */
@Injectable()
export class CryptoPricesScheduler {
  private readonly logger = new Logger(CryptoPricesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly investments: InvestmentsService,
    private readonly kraken: KrakenPriceService,
  ) {}

  @Cron('0 10 0 * * *', { timeZone: 'UTC' })
  async scheduledSync() {
    if (process.env.CRYPTO_PRICES_CRON_ENABLED === 'false') return;
    await this.syncCryptoPrices();
  }

  async syncCryptoPrices(now: Date = new Date()) {
    const assets = await this.prisma.investmentAsset.findMany({
      where: {
        active: true,
        archived: false,
        type: InvestmentAssetType.crypto,
        identificator: { not: null },
        quantity: { gt: new Prisma.Decimal(0) },
      },
      select: { id: true, userId: true, name: true, identificator: true, currency: true, quantity: true },
    });

    // Un fetch por (moneda, divisa), aunque varios usuarios tengan la misma.
    const prices = new Map<string, CryptoClose | null>();
    for (const a of assets) {
      const ticker = a.identificator!.trim().toUpperCase();
      const key = `${ticker}:${a.currency}`;
      if (prices.has(key)) continue;
      if (!TICKER_REGEX.test(ticker)) {
        this.logger.warn(`Asset ${a.id} "${a.name}": identificator "${a.identificator}" no es un ticker válido, se omite`);
        prices.set(key, null);
        continue;
      }
      try {
        const p = await this.kraken.fetchDailyClose(ticker, a.currency, now);
        const ageDays = (now.getTime() - p.closeDate.getTime()) / 86_400_000;
        if (p.closeDate.getTime() > now.getTime() || ageDays > MAX_CLOSE_AGE_DAYS) {
          throw new Error(`cierre ${p.closeDate.toISOString().slice(0, 10)} fuera de rango`);
        }
        prices.set(key, p);
      } catch (e: any) {
        this.logger.warn(`Kraken ${key} falló, no se actualiza: ${e?.message ?? e}`);
        prices.set(key, null);
      }
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_FETCHES_MS));
    }

    const affectedUsers = new Set<number>();
    let written = 0;

    for (const a of assets) {
      const ticker = a.identificator!.trim().toUpperCase();
      const p = prices.get(`${ticker}:${a.currency}`);
      if (!p) continue;

      try {
        const existing = await this.prisma.investmentValuationSnapshot.findUnique({
          where: { userId_assetId_date: { userId: a.userId, assetId: a.id, date: p.closeDate } },
          select: { source: true },
        });
        if (existing && !OVERWRITABLE_SOURCES.includes(existing.source)) {
          this.logger.log(`Asset ${a.id} ${p.closeDate.toISOString().slice(0, 10)}: ya hay snapshot "${existing.source}", se respeta`);
          continue;
        }

        const unitPrice = new Prisma.Decimal(p.price);
        const quantity = new Prisma.Decimal(a.quantity as Prisma.Decimal.Value);
        await this.prisma.$transaction((tx) =>
          this.investments.upsertValuationSnapshotTx(tx, a.userId, {
            assetId: a.id,
            date: p.closeDate,
            value: unitPrice.mul(quantity),
            currency: a.currency,
            unitPrice,
            quantity,
            source: 'kraken',
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

    this.logger.log(`Kraken crypto prices: ${written}/${assets.length} snapshots escritos`);
    return { assets: assets.length, written };
  }
}
