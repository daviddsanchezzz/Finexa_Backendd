import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsService } from './investments.service';
import { ManualMonthData } from '@prisma/client';
import { MonthDataService } from '../monthData/month-data.service';

@Injectable()
export class InvestmentsSnapshotScheduler {
  private readonly logger = new Logger(InvestmentsSnapshotScheduler.name);

  constructor(
    private prisma: PrismaService,
    private investments: InvestmentsService,
    private monthData: MonthDataService
  ) {}

// Día 1 a las 00:05 (Europa/Madrid)
@Cron('0 4 1 * *', { timeZone: 'Europe/Madrid' })
async closePreviousMonth() {
  const users = await this.prisma.user.findMany({
    where: { active: true },
    select: { id: true },
  });

  const now = new Date();

  // Mes actual en UTC: YYYY-MM-01T00:00:00.000Z
  const currentMonthStartUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    1,
    0, 0, 0, 0
  ));

  // Mes a cerrar = mes anterior
  const prevMonthStartUTC = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    1,
    0, 0, 0, 0
  ));

  for (const u of users) {
    try {
      await this.investments.createMonthlySnapshot(u.id, prevMonthStartUTC, true);
    } catch (e: any) {
      this.logger.error(`Snapshot failed user=${u.id}: ${e?.message ?? e}`);
    }
  }
}
}
