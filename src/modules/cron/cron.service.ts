// src/investments/investments.service.ts
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';


@Injectable()
export class CronService {
  constructor(private prisma: PrismaService) {}

async listAssets() {
  return this.prisma.investmentAsset.findMany({
    where: {
      active: true,
      quantity: { gt: 0 }, // si quantity es Decimal
    },
    select: {
      id: true,
      userId: true,
      name: true,
      type: true,
      currency: true,
      identificator: true,  // o identifier
      quantity: true,
      description: true,    // si necesitas ISIN en description no, ya lo tienes en identificator
      riskType: true,
    },
  });
}


}
