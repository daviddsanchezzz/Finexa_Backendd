import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { GoalsController } from './goals.controller';
import { GoalsService } from './goals.service';

@Module({ imports: [PrismaModule], controllers: [GoalsController], providers: [GoalsService] })
export class GoalsModule {}
