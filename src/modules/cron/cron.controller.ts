// src/investments/investments.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CronGuard } from './cron.guard';
import { InvestmentsService } from '../investments/investments.service';
import { CronService } from './cron.service';
import {  UpsertValuationBatchDto } from './dto/valuations.dto';

@Controller('cron')
export class CronController {
  constructor(private readonly cronService: CronService) {}


@Get('assets')
@UseGuards(CronGuard)
listAssetsForCron() {
    return this.cronService.listAssets();
}



  @Post('valuations/upsert')
  @UseGuards(CronGuard)
  upsertValuation(@Body() dto: UpsertValuationBatchDto) {
    return this.cronService.upsertValuationsBatch(dto);
  }


}
