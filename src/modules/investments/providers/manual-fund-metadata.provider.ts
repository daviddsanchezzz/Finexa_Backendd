import { FundMetadataContext, FundMetadataProvider, FundMetadataResult } from '../fund-metadata.types';

export class ManualFundMetadataProvider implements FundMetadataProvider {
  canHandle(_ctx: FundMetadataContext): boolean {
    return true;
  }

  async fetch(_ctx: FundMetadataContext): Promise<FundMetadataResult | null> {
    return null;
  }
}
