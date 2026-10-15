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
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('EODHD sin datos');

  let best: { date: string; close: number } | null = null;
  for (const r of rows) {
    const date = typeof r?.date === 'string' ? r.date : '';
    const close = Number(r?.close);
    if (!DATE_REGEX.test(date) || !Number.isFinite(close) || close <= 0) continue;
    if (!best || date > best.date) best = { date, close };
  }
  if (!best) throw new Error('EODHD sin filas válidas');

  const [, y, m, d] = best.date.match(DATE_REGEX)!;
  return { isin, currency, price: best.close, navDate: new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))) };
}

@Injectable()
export class EodhdFundPriceService {
  private readonly logger = new Logger(EodhdFundPriceService.name);

  isConfigured() {
    return !!process.env.EODHD_API_KEY;
  }

  async fetchFundPrice(isin: string, currency: string): Promise<FundPrice> {
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

    const parsed = parseEodhdEod(data, isin, currency);
    this.logger.log(`EODHD ${isin} = ${parsed.price} (${parsed.navDate.toISOString().slice(0, 10)})`);
    return parsed;
  }
}
