




import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { UpsertValuationBatchDto } from './dto/valuations.dto';
import { InvestmentsService } from '../investments/investments.service';

@Injectable()
export class CronService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly investmentsService: InvestmentsService,
  ) {}

    async listAssets() {
    return this.prisma.investmentAsset.findMany({
      where: {
        active: true,
        quantity: {
          gt: new Prisma.Decimal(0),
        },
      },
      select: {
        id: true,
        userId: true,
        name: true,
        type: true,
        currency: true,
        identificator: true,
        quantity: true,
      },
    });
  }


  private parseDateToUtcMidnight(dateStr: string) {
    const [y, m, d] = String(dateStr ?? '').split('-').map(Number);
    if (!y || !m || !d) throw new BadRequestException('Invalid date');
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  }

  async upsertValuationsBatch(dto: UpsertValuationBatchDto) {
    const date = this.parseDateToUtcMidnight(dto.date);

    // Duplicados
    const seen = new Set<string>();
    for (const it of dto.items) {
      const key = `${it.userId}:${it.assetId}`;
      if (seen.has(key)) {
        throw new BadRequestException(`Duplicate item in batch for userId/assetId: ${key}`);
      }
      seen.add(key);

      const value = new Prisma.Decimal(it.value);
      if (value.isNeg()) throw new BadRequestException('value must be >= 0');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const it of dto.items) {
        // ownership check (puede ser fuera de tx; si quieres 100% coherente, añade assertAssetOwnedTx)
        await this.investmentsService.assertAssetOwned(it.userId, it.assetId);

        const value = new Prisma.Decimal(it.value);
        const unitPrice = it.unitPrice !== undefined ? new Prisma.Decimal(it.unitPrice) : null;
        const quantity = it.quantity !== undefined ? new Prisma.Decimal(it.quantity) : null;

        await this.investmentsService.upsertValuationSnapshotTx(tx, it.userId, {
          assetId: it.assetId,
          date,
          value,
          currency: it.currency,
          unitPrice,
          quantity,
          source: it.source ?? 'cron',
        });
      }
    });

    const users = [...new Set(dto.items.map((x) => x.userId))];
    for (const userId of users) {
      await this.investmentsService.recalcInvestmentWalletBalance(userId);
    }

    return { date: dto.date, upserted: dto.items.length };
  }
}
