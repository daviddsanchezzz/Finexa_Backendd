import axios from 'axios';
import { FundMetadataContext, FundMetadataProvider, FundMetadataResult } from '../fund-metadata.types';

export class YahooFinanceFundMetadataProvider implements FundMetadataProvider {
  canHandle(_ctx: FundMetadataContext): boolean {
    return true;
  }

  private async resolveSymbol(ctx: FundMetadataContext): Promise<string | null> {
    if (ctx.existingSymbol) return ctx.existingSymbol;
    const q = ctx.identificator || ctx.name;
    if (!q) return null;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=1&newsCount=0`;
    const { data } = await axios.get<any>(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const symbol = data?.quotes?.[0]?.symbol;
    return symbol ? String(symbol) : null;
  }

  async fetch(ctx: FundMetadataContext): Promise<FundMetadataResult | null> {
    const symbol = await this.resolveSymbol(ctx);
    if (!symbol) return null;

    const qsUrl = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings,fundProfile`;
    const { data } = await axios.get<any>(qsUrl, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return null;

    const top = result?.topHoldings;
    const sectorWeightingsArr = top?.sectorWeightings ?? [];
    const holdingsArr = top?.holdings ?? [];

    const sectors: Record<string, number> = {};
    for (const row of sectorWeightingsArr) {
      const [name, valObj] = Object.entries(row || {})[0] ?? [];
      const val = Number((valObj as any)?.raw ?? valObj ?? 0);
      if (!name || !Number.isFinite(val) || val <= 0) continue;
      sectors[name] = val * 100;
    }

    const topHoldings = holdingsArr
      .map((h: any) => ({
        name: String(h?.holdingName ?? h?.symbol ?? '').trim(),
        ticker: String(h?.symbol ?? '').trim() || null,
        weight: Number(h?.holdingPercent?.raw ?? 0) * 100,
      }))
      .filter((h: any) => h.name && Number.isFinite(h.weight) && h.weight > 0)
      .slice(0, 10);

    if (!Object.keys(sectors).length && !topHoldings.length) return null;

    return {
      countries: null,
      sectors: Object.keys(sectors).length ? sectors : null,
      topHoldings: topHoldings.length ? topHoldings : null,
      asOfDate: null,
      source: 'yahoo_finance',
      provider: 'yahoo',
      sourceUrl: `https://finance.yahoo.com/quote/${symbol}/holdings/`,
      symbol,
    };
  }
}
