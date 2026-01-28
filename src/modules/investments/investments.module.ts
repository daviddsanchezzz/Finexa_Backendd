import { Module } from '@nestjs/common';
import { InvestmentsController } from './investments.controller';
import { InvestmentsService } from './investments.service';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { InvestmentsSnapshotScheduler } from './InvestmentsSnapshotScheduler';

@Module({
  controllers: [InvestmentsController],
  providers: [InvestmentsService, PrismaService, InvestmentsSnapshotScheduler],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
