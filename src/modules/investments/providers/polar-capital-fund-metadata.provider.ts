import axios from 'axios';
import { FundMetadataContext, FundMetadataProvider, FundMetadataResult } from '../fund-metadata.types';
import { extractNamePercentPairs, normalizeCountry, normalizeSector, normalizeWeightMap, toMap } from '../fund-metadata.utils';

const DEFAULT_POLAR_URL = 'https://www.polarcapital.co.uk/gb/professional/Our-Funds/Global-Technology/#/Portfolio';

export class PolarCapitalFundMetadataProvider implements FundMetadataProvider {
  canHandle(ctx: FundMetadataContext): boolean {
    return String(ctx.provider || '').toLowerCase() === 'polar'
      || /polarcapital\.co\.uk/i.test(String(ctx.metadataUrl || ''))
      || /polar capital/i.test(ctx.name);
  }

  async fetch(ctx: FundMetadataContext): Promise<FundMetadataResult | null> {
    const url = (ctx.metadataUrl && String(ctx.metadataUrl).trim()) || DEFAULT_POLAR_URL;
    const { data } = await axios.get<string>(url, { timeout: 20000 });
    const html = String(data ?? '');

    const allPairs = extractNamePercentPairs(html);
    if (!allPairs.length) return null;

    const countryPairs = allPairs.filter((p) => /united states|japan|united kingdom|canada|france|switzerland|germany|australia|netherlands|spain|other|taiwan|korea|china|india/i.test(p.name));
    const sectorPairs = allPairs.filter((p) => /information technology|financials|industrials|consumer|communication|healthcare|energy|materials|utilities|real estate/i.test(p.name));
    const holdingPairs = allPairs.filter((p) => /^[A-Z0-9 .,&'\-]{3,}$/.test(p.name)).slice(0, 10);

    const countries = normalizeWeightMap(toMap(countryPairs), normalizeCountry);
    const sectors = normalizeWeightMap(toMap(sectorPairs), normalizeSector);
    const topHoldings = holdingPairs.map((h) => ({ name: h.name, ticker: null, weight: h.pct }));

    if (!countries && !sectors && !topHoldings.length) return null;

    return {
      countries,
      sectors,
      topHoldings: topHoldings.length ? topHoldings : null,
      asOfDate: null,
      source: 'official',
      provider: 'polar',
      sourceUrl: url,
    };
  }
}
