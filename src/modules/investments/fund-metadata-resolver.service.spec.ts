import { FundMetadataResolverService } from './fund-metadata-resolver.service';

describe('FundMetadataResolverService', () => {
  it('falls back to next provider when first fails', async () => {
    const svc: any = new FundMetadataResolverService();

    svc.providers = [
      {
        canHandle: () => true,
        fetch: async () => {
          throw new Error('first failed');
        },
      },
      {
        canHandle: () => true,
        fetch: async () => ({
          countries: { 'United States': 70 },
          sectors: null,
          topHoldings: null,
          source: 'manual',
          provider: 'manual',
        }),
      },
    ];

    const out = await svc.resolve({ assetId: 1, name: 'x', type: 'fund' });
    expect(out.result?.provider).toBe('manual');
    expect(out.errors.length).toBe(1);
  });
});
