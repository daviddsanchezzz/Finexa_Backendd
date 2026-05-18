import { Injectable, Logger } from '@nestjs/common';
import { FundMetadataContext, FundMetadataProvider, FundMetadataResult } from './fund-metadata.types';
import { FidelityFundMetadataProvider } from './providers/fidelity-fund-metadata.provider';
import { VanguardFundMetadataProvider } from './providers/vanguard-fund-metadata.provider';
import { PolarCapitalFundMetadataProvider } from './providers/polar-capital-fund-metadata.provider';
import { YahooFinanceFundMetadataProvider } from './providers/yahoo-fund-metadata.provider';
import { ManualFundMetadataProvider } from './providers/manual-fund-metadata.provider';

@Injectable()
export class FundMetadataResolverService {
  private readonly logger = new Logger(FundMetadataResolverService.name);
  private readonly providers: FundMetadataProvider[];

  constructor() {
    this.providers = [
      new FidelityFundMetadataProvider(),
      new VanguardFundMetadataProvider(),
      new PolarCapitalFundMetadataProvider(),
      new YahooFinanceFundMetadataProvider(),
      new ManualFundMetadataProvider(),
    ];
  }

  async resolve(ctx: FundMetadataContext): Promise<{ result: FundMetadataResult | null; errors: string[] }> {
    const errors: string[] = [];

    for (const provider of this.providers) {
      if (!provider.canHandle(ctx)) continue;
      try {
        const result = await provider.fetch(ctx);
        if (result) return { result, errors };
      } catch (e: any) {
        const msg = `${provider.constructor.name}: ${String(e?.message || e)}`;
        errors.push(msg);
        this.logger.warn(`Provider failed asset=${ctx.assetId} -> ${msg}`);
      }
    }

    return { result: null, errors };
  }
}
