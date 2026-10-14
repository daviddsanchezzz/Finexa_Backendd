import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type FtFundPrice = {
  isin: string;
  currency: string;
  price: number;
  // Fecha del valor liquidativo (no la de hoy), a las 00:00 UTC.
  navDate: Date;
};

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export const ISIN_REGEX = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

/**
 * Extrae el NAV de la ficha de un fondo de markets.ft.com.
 * Lanza si la página no es la del fondo/divisa pedidos o si falta precio o fecha:
 * nunca devuelve un valor a medias.
 *
 * La página trae varios "as of"; el que vale es el primero tras el precio
 * (el resto pertenecen a otros módulos y llevan otra fecha).
 */
export function parseFtFundPage(html: string, isin: string, currency: string): FtFundPrice {
  const title = html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '';
  if (!title.includes(`${isin}:${currency}`)) {
    throw new Error(`FT page is not ${isin}:${currency} (title="${title.trim().slice(0, 80)}")`);
  }

  const priceMatch = html.match(
    /Price \(([A-Z]{3})\)<\/span><span class="mod-ui-data-list__value">([\d,]+(?:\.\d+)?)<\/span>/,
  );
  if (!priceMatch) throw new Error('FT price not found');
  if (priceMatch[1] !== currency) {
    throw new Error(`FT price currency ${priceMatch[1]} != ${currency}`);
  }
  const price = Number(priceMatch[2].replace(/,/g, ''));
  if (!Number.isFinite(price) || price <= 0) throw new Error(`FT price invalid: ${priceMatch[2]}`);

  const afterPrice = html.slice((priceMatch.index ?? 0) + priceMatch[0].length);
  const dateMatch = afterPrice.match(/as of ([A-Z][a-z]{2}) (\d{1,2}) (\d{4})/);
  if (!dateMatch || !(dateMatch[1] in MONTHS)) throw new Error('FT NAV date not found');
  const navDate = new Date(Date.UTC(Number(dateMatch[3]), MONTHS[dateMatch[1]], Number(dateMatch[2])));

  return { isin, currency, price, navDate };
}

@Injectable()
export class FtFundPriceService {
  private readonly logger = new Logger(FtFundPriceService.name);

  private readonly HEADERS = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept-Language': 'en-GB,en;q=0.9',
  };

  async fetchFundPrice(isin: string, currency: string): Promise<FtFundPrice> {
    if (!ISIN_REGEX.test(isin)) throw new Error(`Invalid ISIN: ${isin}`);
    const url = `https://markets.ft.com/data/funds/tearsheet/summary?s=${isin}:${currency}`;
    const { data } = await axios.get<string>(url, {
      headers: this.HEADERS,
      timeout: 15_000,
      responseType: 'text',
    });
    const parsed = parseFtFundPage(String(data), isin, currency);
    this.logger.log(`FT ${isin}:${currency} = ${parsed.price} (${parsed.navDate.toISOString().slice(0, 10)})`);
    return parsed;
  }
}
