import { Module } from '@nestjs/common';
import { PrismaService } from 'src/common/prisma/prisma.service';
import { CronController } from './cron.controller';
import { CronService } from './cron.service';
import { InvestmentsModule } from '../investments/investments.module';

@Module({
  imports: [InvestmentsModule],              // ✅ IMPORTA EL MÓDULO
  controllers: [CronController],
  providers: [CronService, PrismaService],   // ✅ ELIMINA InvestmentsService
  exports: [CronService],
})
export class CronModule {}
