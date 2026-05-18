export type HoldingRow = {
  name: string;
  ticker?: string | null;
  weight: number;
};

export type FundMetadataResult = {
  countries?: Record<string, number> | null;
  sectors?: Record<string, number> | null;
  topHoldings?: HoldingRow[] | null;
  asOfDate?: string | null;
  source: 'official' | 'yahoo_finance' | 'manual' | 'crypto-inferred';
  provider: 'fidelity' | 'vanguard' | 'polar' | 'yahoo' | 'manual' | 'crypto';
  sourceUrl?: string | null;
  symbol?: string | null;
};

export type FundMetadataContext = {
  assetId: number;
  name: string;
  type: string;
  provider?: string | null;
  metadataUrl?: string | null;
  identificator?: string | null;
  existingSymbol?: string | null;
};

export interface FundMetadataProvider {
  canHandle(ctx: FundMetadataContext): boolean;
  fetch(ctx: FundMetadataContext): Promise<FundMetadataResult | null>;
}
