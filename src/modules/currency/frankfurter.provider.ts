import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeRateProvider } from './currency.types';

@Injectable()
export class FrankfurterProvider implements ExchangeRateProvider {
  private readonly logger = new Logger(FrankfurterProvider.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: 'https://api.frankfurter.dev/v1', timeout: 10000 });
  }

  async getLatestRates(base: string, quotes: string[]): Promise<Record<string, number>> {
    if (!quotes.length) return {};
    try {
      const { data } = await this.http.get('/latest', { params: { base, symbols: quotes.join(',') } });
      return data?.rates ?? {};
    } catch (err) {
      this.logger.warn(`getLatestRates(${base}, [${quotes.join(',')}]) failed: ${(err as Error).message}`);
      return {};
    }
  }

  async getHistoricalRate(base: string, quote: string, date: Date): Promise<number | null> {
    const day = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
    try {
      const { data } = await this.http.get(`/${day}`, { params: { base, symbols: quote } });
      const rate = data?.rates?.[quote];
      return typeof rate === 'number' ? rate : null;
    } catch (err) {
      this.logger.warn(`getHistoricalRate(${base}, ${quote}, ${day}) failed: ${(err as Error).message}`);
      return null;
    }
  }
}
