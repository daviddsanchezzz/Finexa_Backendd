import { ProjectsService } from './projects.service';

jest.mock('src/common/prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

describe('ProjectsService — isCapitalReturn en movimientos manuales', () => {
  const prisma = {
    project: { findFirst: jest.fn(async () => ({ id: 1 })) },
    projectPartner: { findFirst: jest.fn(async () => ({ id: 10 })) },
    projectManualEntry: {
      create: jest.fn(async ({ data }: any) => ({ id: 100, ...data })),
    },
  };
  const service = new ProjectsService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('por defecto una retirada se clasifica como beneficio (isCapitalReturn=false)', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 1 });
    prisma.projectPartner.findFirst.mockResolvedValueOnce({ id: 10 });

    const result = await service.createManualEntry(1, 1, {
      kind: 'withdrawal',
      title: 'Reparto de beneficios',
      amount: 100,
      date: '2026-01-01',
      partnerId: 10,
    } as any);

    expect(result.isCapitalReturn).toBe(false);
  });

  it('persiste isCapitalReturn=true para una devolución de capital', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 1 });
    prisma.projectPartner.findFirst.mockResolvedValueOnce({ id: 10 });

    const result = await service.createManualEntry(1, 1, {
      kind: 'withdrawal',
      title: 'Devolución de capital',
      amount: 500,
      date: '2026-01-01',
      partnerId: 10,
      isCapitalReturn: true,
    } as any);

    expect(result.isCapitalReturn).toBe(true);
  });
});
