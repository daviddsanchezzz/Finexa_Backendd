import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { UpsertValuationBatchDto } from './dto/valuations.dto';

@Injectable()
export class CronService {
  constructor(private prisma: PrismaService) {}

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
    const [y, m, d] = dateStr.split('-').map(Number);
    if (!y || !m || !d) throw new BadRequestException('Invalid date');
    return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  }

  async upsertValuationsBatch(dto: UpsertValuationBatchDto) {
    const date = this.parseDateToUtcMidnight(dto.date);

    const seen = new Set<string>();
    for (const it of dto.items) {
      const key = `${it.userId}:${it.assetId}`;
      if (seen.has(key)) {
        throw new BadRequestException(`Duplicate item in batch for userId/assetId: ${key}`);
      }
      seen.add(key);
    }

await this.prisma.$transaction(
  dto.items.map((it) => {
    const value = new Prisma.Decimal(it.value);
    const unitPrice = it.unitPrice !== undefined ? new Prisma.Decimal(it.unitPrice) : null;
    const quantity = it.quantity !== undefined ? new Prisma.Decimal(it.quantity) : null;

    if (value.isNeg()) {
      throw new BadRequestException('value must be >= 0');
    }

    return this.prisma.investmentValuationSnapshot.upsert({
      where: {
        userId_assetId_date: {
          userId: it.userId,
          assetId: it.assetId,
          date,
        },
      },
      create: {
        userId: it.userId,
        assetId: it.assetId,
        date,
        currency: it.currency,
        value,
        unitPrice,
        quantity,
        source: it.source ?? 'cron',
        active: true,
      },
      update: {
        currency: it.currency,
        value,
        unitPrice,
        quantity,
        source: it.source ?? 'cron',
        active: true,
      },
    });
  }),
);
 return {
  date: dto.date,
  upserted: dto.items.length,
};

  }
}
