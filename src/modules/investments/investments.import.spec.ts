import * as XLSX from 'xlsx';
import { InvestmentsService } from './investments.service';

jest.mock('src/common/prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

function buildSampleWorkbookBuffer(): Buffer {
  const aoa: any[][] = [
    ['', 'OpenBank', 'PP Miguel Mapfre', 'P.P. Pili', 'P.P. Europa', 'P.P. America', 'Capital Advisor', 'Total', '', 'Cripto'],
    ['', '', '', '', '', '', '', 0, '', ''],
    ['', '', '', '', '', '', '', 0, '', ''],
    [new Date(Date.UTC(2026, 1, 1)), 2328.65, 2669.52, 1465.97, 15015.77, 20871.76, 13042.0, 55393.67, '', 577.39],
    [new Date(Date.UTC(2026, 1, 5)), 2325.78, 2666.79, 1467.89, 15043.74, 20899.11, 13064.03, 55467.34, '', 604.74],
    [new Date(Date.UTC(2026, 1, 6)), '', '', '', '', '', '', 0, '', ''],
    [new Date(Date.UTC(2026, 1, 7)), 2342.82, 2671.82, 1486.45, 15154.09, 21163.33, 13203.31, 56021.82, '', 609.47],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Valoraciones');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellDates: true });
}

describe('Import de valoraciones desde Excel', () => {
  const service = new InvestmentsService({} as any, {} as any);

  it('detecta columnas (sin Total), filas con fecha y valores, e ignora filas vacías', () => {
    const buffer = buildSampleWorkbookBuffer();
    const result = service.parseValuationImportFile(buffer);

    expect(result.columns).toEqual([
      'OpenBank',
      'PP Miguel Mapfre',
      'P.P. Pili',
      'P.P. Europa',
      'P.P. America',
      'Capital Advisor',
      'Cripto',
    ]);
    expect(result.columns).not.toContain('Total');

    // Las 2 filas iniciales en blanco y la fila "1/6" (sin valores) se descartan.
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0].date).toBe('2026-02-01');
    expect(result.rows[0].values.OpenBank).toBeCloseTo(2328.65);
    expect(result.rows[0].values.Cripto).toBeCloseTo(577.39);
    expect(result.dateRange).toEqual({ from: '2026-02-01', to: '2026-02-07' });
  });

  it('rechaza un archivo sin columnas de activos detectables', () => {
    const sheet = XLSX.utils.aoa_to_sheet([['', '', ''], ['', '', '']]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Hoja1');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    expect(() => service.parseValuationImportFile(buffer)).toThrow();
  });
});

describe('commitValuationsImport', () => {
  const upserts: any[] = [];
  const prisma = {
    investmentAsset: {
      findFirst: jest.fn(async ({ where }: any) => ({ id: where.id, userId: where.userId })),
    },
    $transaction: jest.fn(async (fn: any) => fn({} as any)),
  };
  const service = new InvestmentsService(prisma as any, {} as any);

  beforeEach(() => {
    jest.clearAllMocks();
    upserts.length = 0;
    jest.spyOn(service, 'recalcInvestmentWalletBalance').mockResolvedValue(undefined);
    jest.spyOn(service, 'upsertValuationSnapshotTx').mockImplementation(async (_tx: any, userId: number, dto: any) => {
      upserts.push({ userId, ...dto });
      return dto;
    });
  });

  it('solo escribe celdas con valor numérico, con la moneda por columna', async () => {
    const result = await service.commitValuationsImport(7, {
      mapping: {
        OpenBank: { assetId: 10 },
        Cripto: { assetId: 11, currency: 'USD' },
      },
      rows: [
        { date: '2026-02-01', values: { OpenBank: 2328.65, Cripto: 577.39 } },
        { date: '2026-02-06', values: { OpenBank: null, Cripto: null } },
        { date: '2026-02-07', values: { OpenBank: 2342.82, Cripto: null } },
      ],
    });

    expect(result.count).toBe(3);
    expect(upserts).toHaveLength(3);
    expect(upserts.find((u) => u.assetId === 11)?.currency).toBe('USD');
    expect(upserts.every((u) => u.assetId === 10 ? u.currency === 'EUR' : true)).toBe(true);
    expect(service.recalcInvestmentWalletBalance).toHaveBeenCalledWith(7);
  });

  it('falla si ninguna columna del mapeo tiene un assetId válido', async () => {
    await expect(
      service.commitValuationsImport(7, { mapping: {}, rows: [] }),
    ).rejects.toThrow();
  });
});
