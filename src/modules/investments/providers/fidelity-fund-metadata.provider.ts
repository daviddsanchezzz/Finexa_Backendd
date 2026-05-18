import axios from 'axios';
import { FundMetadataContext, FundMetadataProvider, FundMetadataResult } from '../fund-metadata.types';
import { extractNamePercentPairs, normalizeCountry, normalizeSector, normalizeWeightMap, toMap } from '../fund-metadata.utils';

function deduceAsOfDate(html: string): string | null {
  const m = html.match(/(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}-\d{2}-\d{2})/);
  if (!m) return null;
  const raw = m[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [d, mo, y] = raw.includes('/') ? raw.split('/') : raw.split('-');
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export class FidelityFundMetadataProvider implements FundMetadataProvider {
  canHandle(ctx: FundMetadataContext): boolean {
    return !!ctx.identificator && /^IE[0-9A-Z]{10}$/i.test(ctx.identificator);
  }

  async fetch(ctx: FundMetadataContext): Promise<FundMetadataResult | null> {
    if (!ctx.identificator) return null;
    const url = `https://www.fondosfidelity.es/fondos/ficha/${ctx.identificator}/tab-portfolio`;
    const { data } = await axios.get<string>(url, { timeout: 20000 });
    const html = String(data ?? '');

    const allPairs = extractNamePercentPairs(html);
    if (!allPairs.length) return null;

    const countryPairs = allPairs.filter((p) => /estados unidos|jap|reino unido|canad|francia|suiza|alemania|australia|holanda|españa|otros/i.test(p.name));
    const sectorPairs = allPairs.filter((p) => /tecnolog|financier|industr|consumo|comunicaci|sanidad|energ|material|suministros|inmobiliarias/i.test(p.name));
    const holdingPairs = allPairs.filter((p) => /^[A-Z0-9 .,&'\-]{3,}$/.test(p.name)).slice(0, 10);

    const countries = normalizeWeightMap(toMap(countryPairs), normalizeCountry);
    const sectors = normalizeWeightMap(toMap(sectorPairs), normalizeSector);
    const topHoldings = holdingPairs.map((h) => ({ name: h.name, ticker: null, weight: h.pct }));

    if (!countries && !sectors && !topHoldings.length) return null;

    return {
      countries,
      sectors,
      topHoldings: topHoldings.length ? topHoldings : null,
      asOfDate: deduceAsOfDate(html),
      source: 'official',
      provider: 'fidelity',
      sourceUrl: url,
    };
  }
}
