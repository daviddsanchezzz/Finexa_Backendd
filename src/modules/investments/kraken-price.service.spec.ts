import { krakenPair, parseKrakenDailyClose } from './kraken-price.service';

const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000;
const candle = (iso: string, close: number | string) => [day(iso), '1', '1', '1', String(close), '1', '1', 1];
const body = (candles: any[], key = 'XXBTZEUR') => ({ error: [], result: { [key]: candles, last: 1 } });
const NOW = new Date(Date.UTC(2026, 9, 15, 0, 10));

describe('krakenPair', () => {
  it('traduce BTC a XBT y deja el resto', () => {
    expect(krakenPair('BTC', 'EUR')).toBe('XBTEUR');
    expect(krakenPair('ETH', 'EUR')).toBe('ETHEUR');
    expect(krakenPair('SOL', 'USD')).toBe('SOLUSD');
  });
});

describe('parseKrakenDailyClose', () => {
  it('usa la última vela cerrada y ignora la de hoy (en curso)', () => {
    const r = parseKrakenDailyClose(
      body([candle('2026-10-13', 74193.4), candle('2026-10-14', 72888.3), candle('2026-10-15', 72176.6)]),
      'BTC', 'EUR', NOW,
    );
    expect(r.price).toBe(72888.3);
    expect(r.closeDate.toISOString()).toBe('2026-10-14T00:00:00.000Z');
  });

  it('no depende del orden y de la clave del par (XXBTZEUR, XETHZEUR…)', () => {
    const r = parseKrakenDailyClose(body([candle('2026-10-14', 2160.99), candle('2026-10-13', 2229.23)], 'XETHZEUR'), 'ETH', 'EUR', NOW);
    expect(r.price).toBe(2160.99);
  });

  it('ignora velas inválidas', () => {
    const r = parseKrakenDailyClose(body([candle('2026-10-14', 0), candle('2026-10-13', 'x'), candle('2026-10-12', 73284.2)]), 'BTC', 'EUR', NOW);
    expect(r.price).toBe(73284.2);
  });

  it('falla si Kraken devuelve error (par desconocido)', () => {
    expect(() => parseKrakenDailyClose({ error: ['EQuery:Unknown asset pair'], result: {} }, 'XXX', 'EUR', NOW)).toThrow(/Unknown asset pair/);
  });

  it('falla si solo hay la vela de hoy o ninguna', () => {
    expect(() => parseKrakenDailyClose(body([candle('2026-10-15', 72000)]), 'BTC', 'EUR', NOW)).toThrow(/cerradas/);
    expect(() => parseKrakenDailyClose(body([]), 'BTC', 'EUR', NOW)).toThrow(/sin velas/);
    expect(() => parseKrakenDailyClose(null, 'BTC', 'EUR', NOW)).toThrow();
  });
});
