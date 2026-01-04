import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [PrismaService],
  exports: [],
})
export class HealthModule {}
