import { Module } from '@nestjs/common';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsSnapshotScheduler } from './InvestmentsSnapshotScheduler';
import { PricesFetcherService } from './prices-fetcher.service';
import { FmpService } from './fmp.service';
import { InvestmentExposureService } from './investment-exposure.service';
import { FundMetadataResolverService } from './fund-metadata-resolver.service';

@Module({
  controllers: [InvestmentsController],
  providers: [
    InvestmentsService,
    PrismaService,
    InvestmentsSnapshotScheduler,
    PricesFetcherService,
    FmpService,
    FundMetadataResolverService,
    InvestmentExposureService,
  ],
  exports: [InvestmentsService, InvestmentExposureService],
})
export class InvestmentsModule {}
