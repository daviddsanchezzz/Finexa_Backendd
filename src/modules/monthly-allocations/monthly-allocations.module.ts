import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { AllocationPlanController } from './monthly-allocations.controller';
import { AllocationPlanService } from './monthly-allocations.service';

@Module({
  controllers: [AllocationPlanController],
  providers: [AllocationPlanService, PrismaService],
})
export class AllocationPlanModule {}
