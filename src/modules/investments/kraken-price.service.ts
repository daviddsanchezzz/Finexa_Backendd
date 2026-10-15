import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

export type CryptoClose = {
  ticker: string;
  currency: string;
  price: number;
  // Día UTC al que pertenece el cierre, a las 00:00 UTC.
  closeDate: Date;
};

// Kraken llama XBT a Bitcoin; el resto de tickers coinciden con el símbolo habitual.
const KRAKEN_BASE: Record<string, string> = { BTC: 'XBT' };

export const TICKER_REGEX = /^[A-Z0-9]{2,10}$/;

export function krakenPair(ticker: string, currency: string) {
  return `${KRAKEN_BASE[ticker] ?? ticker}${currency}`;
}

/**
 * Interpreta la respuesta de Kraken `/0/public/OHLC?interval=1440` y devuelve el
 * cierre de la última vela diaria YA CERRADA (la vela de hoy, en curso, se
 * ignora). Lanza si Kraken devuelve error o no hay ninguna vela válida.
 */
export function parseKrakenDailyClose(body: any, ticker: string, currency: string, now: Date): CryptoClose {
  if (Array.isArray(body?.error) && body.error.length) throw new Error(`Kraken: ${body.error.join(', ')}`);
  const result = body?.result;
  const key = result && Object.keys(result).find((k) => k !== 'last');
  const candles: any[] = key ? result[key] : [];
  if (!Array.isArray(candles) || candles.length === 0) throw new Error('Kraken sin velas');

  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000;
  let best: { time: number; close: number } | null = null;
  for (const c of candles) {
    const time = Number(c?.[0]);
    const close = Number(c?.[4]);
    if (!Number.isFinite(time) || !Number.isFinite(close) || close <= 0) continue;
    if (time >= todayUtc) continue; // vela en curso
    if (!best || time > best.time) best = { time, close };
  }
  if (!best) throw new Error('Kraken sin velas cerradas válidas');

  return { ticker, currency, price: best.close, closeDate: new Date(best.time * 1000) };
}

@Injectable()
export class KrakenPriceService {
  private readonly logger = new Logger(KrakenPriceService.name);

  async fetchDailyClose(ticker: string, currency: string, now: Date = new Date()): Promise<CryptoClose> {
    if (!TICKER_REGEX.test(ticker)) throw new Error(`Invalid ticker: ${ticker}`);
    const pair = krakenPair(ticker, currency);
    const since = Math.floor(now.getTime() / 1000) - 5 * 86_400;

    let data: unknown;
    try {
      const res = await axios.get('https://api.kraken.com/0/public/OHLC', {
        params: { pair, interval: 1440, since },
        timeout: 15_000,
      });
      data = res.data;
    } catch (e: any) {
      throw new Error(`Kraken HTTP ${e?.response?.status ?? 'error'} (${e?.code ?? 'sin código'})`);
    }

    const parsed = parseKrakenDailyClose(data, ticker, currency, now);
    this.logger.log(`Kraken ${pair} = ${parsed.price} (cierre ${parsed.closeDate.toISOString().slice(0, 10)})`);
    return parsed;
  }
}
