export type ExposureEntry = { name: string; value: number; percentage: number };

export type HoldingMeta = {
  name: string;
  ticker?: string | null;
  weight: number;
  country?: string | null;
  sector?: string | null;
};

export type AssetExposureInput = {
  currentValue: number;
  countries?: Record<string, number> | null;
  sectors?: Record<string, number> | null;
  topHoldings?: HoldingMeta[] | null;
};

export function toSortedExposure(map: Map<string, number>, denominator: number): ExposureEntry[] {
  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      value,
      percentage: denominator > 0 ? (value / denominator) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export function computeExposureBuckets(assets: AssetExposureInput[]) {
  const totalPortfolioValue = assets.reduce((sum, a) => sum + Number(a.currentValue || 0), 0);
  const countries = new Map<string, number>();
  const sectors = new Map<string, number>();
  const holdings = new Map<string, { name: string; ticker?: string | null; value: number }>();

  const add = (m: Map<string, number>, key: string, value: number) => {
    m.set(key, (m.get(key) ?? 0) + value);
  };

  for (const asset of assets) {
    const value = Number(asset.currentValue || 0);
    if (value <= 0) continue;

    if (asset.countries && Object.keys(asset.countries).length > 0) {
      for (const [country, pct] of Object.entries(asset.countries)) {
        const contribution = value * (Number(pct || 0) / 100);
        if (contribution > 0) add(countries, country, contribution);
      }
    } else {
      add(countries, 'Unknown', value);
    }

    if (asset.sectors && Object.keys(asset.sectors).length > 0) {
      for (const [sector, pct] of Object.entries(asset.sectors)) {
        const contribution = value * (Number(pct || 0) / 100);
        if (contribution > 0) add(sectors, sector, contribution);
      }
    } else {
      add(sectors, 'Unknown', value);
    }

    for (const h of asset.topHoldings ?? []) {
      const k = `${(h.ticker || '').toUpperCase()}::${h.name}`;
      const contribution = value * (Number(h.weight || 0) / 100);
      if (contribution <= 0) continue;
      const prev = holdings.get(k) ?? { name: h.name, ticker: h.ticker ?? null, value: 0 };
      prev.value += contribution;
      holdings.set(k, prev);
    }
  }

  const holdingsRows = [...holdings.values()]
    .map((h) => ({
      name: h.name,
      ticker: h.ticker ?? null,
      value: h.value,
      percentage: totalPortfolioValue > 0 ? (h.value / totalPortfolioValue) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);

  return {
    totalPortfolioValue,
    countries: toSortedExposure(countries, totalPortfolioValue),
    sectors: toSortedExposure(sectors, totalPortfolioValue),
    indirectHoldings: holdingsRows,
  };
}
