import axios from 'axios';
import { FrankfurterProvider } from './frankfurter.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FrankfurterProvider', () => {
  const http = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(http as any);
  });

  it('getLatestRates devuelve el mapa de rates', async () => {
    http.get.mockResolvedValue({ data: { base: 'EUR', date: '2026-09-22', rates: { CHF: 0.9393, USD: 1.1463 } } });
    const provider = new FrankfurterProvider();

    const rates = await provider.getLatestRates('EUR', ['CHF', 'USD']);

    expect(rates).toEqual({ CHF: 0.9393, USD: 1.1463 });
    expect(http.get).toHaveBeenCalledWith('/latest', { params: { base: 'EUR', symbols: 'CHF,USD' } });
  });

  it('getLatestRates con lista vacía no llama a la API', async () => {
    const provider = new FrankfurterProvider();
    const rates = await provider.getLatestRates('EUR', []);
    expect(rates).toEqual({});
    expect(http.get).not.toHaveBeenCalled();
  });

  it('getHistoricalRate devuelve el rate para esa fecha', async () => {
    http.get.mockResolvedValue({ data: { base: 'EUR', date: '2026-09-01', rates: { CHF: 0.94 } } });
    const provider = new FrankfurterProvider();

    const rate = await provider.getHistoricalRate('EUR', 'CHF', new Date('2026-09-01T00:00:00.000Z'));

    expect(rate).toBe(0.94);
    expect(http.get).toHaveBeenCalledWith('/2026-09-01', { params: { base: 'EUR', symbols: 'CHF' } });
  });

  it('getHistoricalRate devuelve null si la API falla (nunca lanza)', async () => {
    http.get.mockRejectedValue(new Error('network down'));
    const provider = new FrankfurterProvider();

    const rate = await provider.getHistoricalRate('EUR', 'CHF', new Date('2026-09-01T00:00:00.000Z'));

    expect(rate).toBeNull();
  });

  it('getHistoricalRate devuelve null si la respuesta no trae la moneda pedida', async () => {
    http.get.mockResolvedValue({ data: { base: 'EUR', date: '2026-09-01', rates: {} } });
    const provider = new FrankfurterProvider();

    const rate = await provider.getHistoricalRate('EUR', 'CHF', new Date('2026-09-01T00:00:00.000Z'));

    expect(rate).toBeNull();
  });
});
