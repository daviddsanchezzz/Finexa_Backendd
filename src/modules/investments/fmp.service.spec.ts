import { FmpService } from './fmp.service';

describe('FmpService normalizers', () => {
  const svc = new FmpService();

  it('normalizes weight maps from mixed payloads', () => {
    const out = svc.normalizeWeightMap(
      [
        { country: 'United States', weight: 60.5 },
        { name: 'Japan', percentage: 5.4 },
        { country: 'United States', percent: 1.1 },
      ],
      ['country', 'name'],
    );

    expect(out['United States']).toBeCloseTo(61.6);
    expect(out['Japan']).toBeCloseTo(5.4);
  });

  it('normalizes holdings and sorts by weight', () => {
    const out = svc.normalizeHoldings([
      { name: 'Microsoft', symbol: 'MSFT', weight: 4.8, country: 'United States', sector: 'Technology' },
      { company: 'Apple', ticker: 'AAPL', percentage: 5.1, country: 'United States', sector: 'Technology' },
    ]);

    expect(out[0].name).toBe('Apple');
    expect(out[0].ticker).toBe('AAPL');
    expect(out[1].name).toBe('Microsoft');
  });
});
