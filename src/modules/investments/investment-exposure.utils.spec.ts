import { computeExposureBuckets } from './investment-exposure.utils';

describe('computeExposureBuckets', () => {
  it('aggregates countries, sectors and holdings using asset current value', () => {
    const out = computeExposureBuckets([
      {
        currentValue: 1000,
        countries: { 'United States': 70, Japan: 30 },
        sectors: { Technology: 60, Healthcare: 40 },
        topHoldings: [
          { name: 'Apple', ticker: 'AAPL', weight: 5 },
          { name: 'Microsoft', ticker: 'MSFT', weight: 4 },
        ],
      },
      {
        currentValue: 500,
        countries: { 'United States': 50, Germany: 50 },
        sectors: { Technology: 20, Industrials: 80 },
        topHoldings: [{ name: 'Apple', ticker: 'AAPL', weight: 2 }],
      },
    ]);

    expect(out.totalPortfolioValue).toBe(1500);

    const us = out.countries.find((x) => x.name === 'United States');
    expect(us?.value).toBeCloseTo(950);

    const tech = out.sectors.find((x) => x.name === 'Technology');
    expect(tech?.value).toBeCloseTo(700);

    const apple = out.indirectHoldings.find((x) => x.ticker === 'AAPL');
    expect(apple?.value).toBeCloseTo(60);
  });

  it('puts missing metadata into Unknown buckets', () => {
    const out = computeExposureBuckets([{ currentValue: 200 }]);
    expect(out.countries[0].name).toBe('Unknown');
    expect(out.countries[0].value).toBe(200);
    expect(out.sectors[0].name).toBe('Unknown');
    expect(out.sectors[0].value).toBe(200);
  });
});
