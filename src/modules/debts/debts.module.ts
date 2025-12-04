import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { DebtsService } from './debts.service';
import { DebtsController } from './debts.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DebtsController],
  providers: [DebtsService],
})
export class DebtsModule {}