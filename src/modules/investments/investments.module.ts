import { Module } from '@nestjs/common';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsSnapshotScheduler } from './InvestmentsSnapshotScheduler';
import { PricesFetcherService } from './prices-fetcher.service';

@Module({
  controllers: [InvestmentsController],
  providers: [InvestmentsService, PrismaService, InvestmentsSnapshotScheduler, PricesFetcherService],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
