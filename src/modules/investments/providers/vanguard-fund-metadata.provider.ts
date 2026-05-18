import axios from 'axios';
import { FundMetadataContext, FundMetadataProvider, FundMetadataResult } from '../fund-metadata.types';
import { extractNamePercentPairs, normalizeCountry, normalizeSector, normalizeWeightMap, toMap } from '../fund-metadata.utils';

const VANGUARD_URLS: Array<{ match: RegExp; url: string }> = [
  {
    match: /emerging markets stock index fund eur acc/i,
    url: 'https://www.es.vanguard/profesionales/producto/fondo/renta-variable/9229/emerging-markets-stock-index-fund-eur-acc',
  },
  {
    match: /global small-cap index fund eur investor shares/i,
    url: 'https://www.es.vanguard/profesionales/producto/fondo/renta-variable/9248/global-small-cap-index-fund-eur-investor-shares',
  },
];

export class VanguardFundMetadataProvider implements FundMetadataProvider {
  canHandle(ctx: FundMetadataContext): boolean {
    return VANGUARD_URLS.some((x) => x.match.test(ctx.name));
  }

  async fetch(ctx: FundMetadataContext): Promise<FundMetadataResult | null> {
    const entry = VANGUARD_URLS.find((x) => x.match.test(ctx.name));
    if (!entry) return null;
    const { data } = await axios.get<string>(entry.url, { timeout: 20000 });
    const html = String(data ?? '');

    const allPairs = extractNamePercentPairs(html);
    if (!allPairs.length) return null;

    const countryPairs = allPairs.filter((p) => /united states|japan|united kingdom|canada|france|switzerland|germany|australia|netherlands|spain|other|emerging|china|india|taiwan|korea|brazil|south africa/i.test(p.name));
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
      provider: 'vanguard',
      sourceUrl: entry.url,
    };
  }
}
