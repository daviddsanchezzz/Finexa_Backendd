import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

// Maps common ticker symbols to CoinGecko IDs.
// The identificator field can store either a ticker (BTC) or a CoinGecko ID (bitcoin) — both work.
const TICKER_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  ADA: 'cardano',
  AVAX: 'avalanche-2',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LINK: 'chainlink',
  UNI: 'uniswap',
  LTC: 'litecoin',
  DOGE: 'dogecoin',
  ATOM: 'cosmos',
  NEAR: 'near',
  OP: 'optimism',
  ARB: 'arbitrum',
};

@Injectable()
export class PricesFetcherService {
  private readonly logger = new Logger(PricesFetcherService.name);

  private readonly YAHOO_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

  private resolveCoinGeckoId(identifier: string): string {
    const mapped = TICKER_TO_COINGECKO[identifier.toUpperCase()];
    return mapped ?? identifier.toLowerCase();
  }

  /**
   * Accepts ticker symbols (BTC, ETH) or CoinGecko IDs (bitcoin, ethereum).
   * Returns a map of { original identifier → price in EUR }.
   */
  async fetchCryptoPrices(identifiers: string[]): Promise<Map<string, number>> {
    // Build identifier → coingeckoId map
    const identToId = new Map<string, string>();
    for (const id of identifiers) {
      identToId.set(id, this.resolveCoinGeckoId(id));
    }

    const cgIds = [...new Set(identToId.values())].join(',');
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${cgIds}&vs_currencies=eur`;
    const { data } = await axios.get(url, { timeout: 10_000 });

    const result = new Map<string, number>();
    for (const [original, cgId] of identToId) {
      if (data[cgId]?.eur != null) result.set(original, data[cgId].eur);
    }
    return result;
  }

  /**
   * Resolves an ISIN to a Yahoo Finance symbol, then fetches the current price.
   * Works for ETFs, stocks, and UCITS funds listed on Yahoo Finance.
   */
  async fetchEquityPriceByISIN(
    isin: string,
  ): Promise<{ price: number; currency: string } | null> {
    const searchUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${isin}&quotesCount=1&newsCount=0`;
    const searchRes = await axios.get(searchUrl, {
      headers: this.YAHOO_HEADERS,
      timeout: 10_000,
    });

    const symbol: string | undefined = searchRes.data?.quotes?.[0]?.symbol;
    if (!symbol) {
      this.logger.warn(`No Yahoo Finance symbol found for ISIN ${isin}`);
      return null;
    }

    const quoteUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    const quoteRes = await axios.get(quoteUrl, {
      headers: this.YAHOO_HEADERS,
      timeout: 10_000,
    });

    const meta = quoteRes.data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    return {
      price: meta.regularMarketPrice as number,
      currency: (meta.currency as string) ?? 'EUR',
    };
  }
}
