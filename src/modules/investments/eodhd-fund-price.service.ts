import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type FundPrice = {
  isin: string;
  currency: string;
  price: number;
  // Fecha del valor liquidativo (no la de hoy), a las 00:00 UTC.
  navDate: Date;
};

export const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Interpreta la respuesta de EODHD `/api/eod/{ISIN}.EUFUND` y devuelve el NAV
 * más reciente. Lanza si la respuesta no es una lista con al menos una fila
 * válida (fecha y close > 0): nunca devuelve un valor a medias.
 */
export function parseEodhdEod(rows: unknown, isin: string, currency: string): FundPrice {
  const all = parseEodhdEodAll(rows, isin, currency);
  return all[all.length - 1];
}

/**
 * Todas las filas válidas (fecha y close > 0) ordenadas de más antigua a más
 * reciente, sin fechas repetidas. Lanza si no hay ninguna.
 */
export function parseEodhdEodAll(rows: unknown, isin: string, currency: string): FundPrice[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('EODHD sin datos');

  const byDate = new Map<string, number>();
  for (const r of rows) {
    const date = typeof r?.date === 'string' ? r.date : '';
    const close = Number(r?.close);
    if (!DATE_REGEX.test(date) || !Number.isFinite(close) || close <= 0) continue;
    byDate.set(date, close);
  }
  if (!byDate.size) throw new Error('EODHD sin filas válidas');

  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, close]) => {
      const [, y, m, d] = date.match(DATE_REGEX)!;
      return { isin, currency, price: close, navDate: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))) };
    });
}

@Injectable()
export class EodhdFundPriceService {
  private readonly logger = new Logger(EodhdFundPriceService.name);

  isConfigured() {
    return !!process.env.EODHD_API_KEY;
  }

  async fetchFundPrice(isin: string, currency: string): Promise<FundPrice> {
    const all = await this.fetchFundPrices(isin, currency);
    return all[all.length - 1];
  }

  /** Los NAV de los últimos 14 días en una sola llamada (una sola consulta del límite diario). */
  async fetchFundPrices(isin: string, currency: string): Promise<FundPrice[]> {
    const token = process.env.EODHD_API_KEY;
    if (!token) throw new Error('EODHD_API_KEY is not configured');
    if (!ISIN_REGEX.test(isin)) throw new Error(`Invalid ISIN: ${isin}`);

    const from = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    let data: unknown;
    try {
      const res = await axios.get(`https://eodhd.com/api/eod/${isin}.EUFUND`, {
        params: { api_token: token, fmt: 'json', order: 'd', from },
        timeout: 15_000,
      });
      data = res.data;
    } catch (e: any) {
      // Sin e.config/e.request: llevan la URL con el token.
      throw new Error(`EODHD HTTP ${e?.response?.status ?? 'error'} (${e?.code ?? 'sin código'})`);
    }

    const parsed = parseEodhdEodAll(data, isin, currency);
    const last = parsed[parsed.length - 1];
    this.logger.log(`EODHD ${isin} = ${last.price} (${last.navDate.toISOString().slice(0, 10)})`);
    return parsed;
  }
}
