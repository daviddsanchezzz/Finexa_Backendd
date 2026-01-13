import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsService } from './investments.service';

@Injectable()
export class InvestmentsSnapshotScheduler {
  private readonly logger = new Logger(InvestmentsSnapshotScheduler.name);

  constructor(
    private prisma: PrismaService,
    private investments: InvestmentsService,
  ) {}

  // Día 1 a las 00:05 (hora local del server; si quieres, fuerza TZ a Europe/Madrid en el entorno)
  @Cron('5 0 1 * *')
  async closePreviousMonth() {
    // obtén todos los users activos (o solo los que tienen assets)
    const users = await this.prisma.user.findMany({
      where: { active: true },
      select: { id: true },
    });

    const now = new Date();
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)); 
    // día 0 del mes actual => último día del mes anterior (UTC)

    for (const u of users) {
      try {
        await this.investments.upsertPortfolioSnapshot(u.id, target, true);
      } catch (e: any) {
        this.logger.error(`Snapshot failed user=${u.id}: ${e?.message ?? e}`);
      }
    }
  }
}
