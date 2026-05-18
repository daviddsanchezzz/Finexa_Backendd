import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

export type HoldingRow = {
  name: string;
  ticker?: string | null;
  weight: number;
  country?: string | null;
  sector?: string | null;
};

@Injectable()
export class FmpService {
  private readonly logger = new Logger(FmpService.name);
  private readonly http: AxiosInstance;
  private readonly apiKey: string;

  constructor() {
    this.apiKey = process.env.FMP_API_KEY ?? '';
    this.http = axios.create({
      baseURL: 'https://financialmodelingprep.com/stable',
      timeout: 15000,
    });
  }

  isConfigured() {
    return !!this.apiKey;
  }

  private async get<T = any>(path: string, params: Record<string, any>) {
    if (!this.apiKey) throw new Error('FMP_API_KEY is not configured');
    const res = await this.http.get<T>(path, { params: { ...params, apikey: this.apiKey } });
    return res.data;
  }

  async searchByIsin(isin: string) {
    const data = await this.get<any[]>('/search-isin', { query: isin });
    return Array.isArray(data) ? data : [];
  }

  async searchByName(query: string) {
    const data = await this.get<any[]>('/search-name', { query });
    return Array.isArray(data) ? data : [];
  }

  async etfInfo(symbol: string) {
    return this.get<any[]>('/etf-info', { symbol });
  }

  async countryWeightings(symbol: string) {
    return this.get<any[]>('/etf-country-weightings', { symbol });
  }

  async sectorWeightings(symbol: string) {
    return this.get<any[]>('/etf-sector-weightings', { symbol });
  }

  async holdings(symbol: string) {
    try {
      const rows = await this.get<any[]>('/etf-holdings', { symbol });
      if (Array.isArray(rows) && rows.length) return rows;
    } catch (e: any) {
      this.logger.warn(`etf-holdings failed for ${symbol}: ${e?.message ?? e}`);
    }
    const fallback = await this.get<any[]>('/etf-holder', { symbol });
    return Array.isArray(fallback) ? fallback : [];
  }

  normalizeWeightMap(rows: any[], keyCandidates: string[]): Record<string, number> {
    const result: Record<string, number> = {};

    for (const row of rows ?? []) {
      const key = keyCandidates.map((k) => row?.[k]).find((v) => typeof v === 'string' && v.trim()) as string | undefined;
      const valueRaw = row?.weight ?? row?.percentage ?? row?.percent ?? row?.allocation;
      const value = Number(valueRaw);
      if (!key || !Number.isFinite(value) || value <= 0) continue;
      result[key.trim()] = (result[key.trim()] ?? 0) + value;
    }

    return result;
  }

  normalizeHoldings(rows: any[]): HoldingRow[] {
    const out: HoldingRow[] = [];
    for (const row of rows ?? []) {
      const name = String(row?.name ?? row?.asset ?? row?.company ?? '').trim();
      const ticker = String(row?.symbol ?? row?.ticker ?? '').trim();
      const weight = Number(row?.weight ?? row?.percentage ?? row?.percent ?? 0);
      const country = String(row?.country ?? '').trim();
      const sector = String(row?.sector ?? '').trim();
      if (!name || !Number.isFinite(weight) || weight <= 0) continue;
      out.push({
        name,
        ticker: ticker || null,
        weight,
        country: country || null,
        sector: sector || null,
      });
    }
    return out.sort((a, b) => b.weight - a.weight);
  }

  pickSymbolFromSearch(rows: any[]): string | null {
    for (const row of rows ?? []) {
      const symbol = String(row?.symbol ?? row?.ticker ?? '').trim();
      if (symbol) return symbol;
    }
    return null;
  }

  async resolveSymbol({ isin, name }: { isin?: string | null; name?: string | null }): Promise<string | null> {
    if (isin?.trim()) {
      const rows = await this.searchByIsin(isin.trim());
      const symbol = this.pickSymbolFromSearch(rows);
      if (symbol) return symbol;
    }

    if (name?.trim()) {
      const rows = await this.searchByName(name.trim());
      const symbol = this.pickSymbolFromSearch(rows);
      if (symbol) return symbol;
    }

    return null;
  }
}
