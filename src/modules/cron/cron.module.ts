import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';

@Module({
  controllers: [CronController],
  providers: [CronService, PrismaService],
  exports: [CronService],
})
export class CronModule {}
