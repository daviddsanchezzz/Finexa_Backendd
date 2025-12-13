import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { CreateInvestmentAssetDto } from './dto/create-investment-asset.dto';
import { UpdateInvestmentAssetDto } from './dto/update-investment-asset.dto';
import { CreateInvestmentValuationDto } from './dto/create-valuation.dto';
import { UpdateInvestmentValuationDto } from './dto/update-valuation.dto';
import { User } from 'src/common/decorators/user.decorator';

@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  // -----------------------------
  // Assets
  // -----------------------------
  @Get('assets')
  listAssets(@User('userId') userId: number) {
    return this.investmentsService.listAssets(userId);
  }

  @Post('assets')
  createAsset(@User('userId') userId: number, @Body() dto: CreateInvestmentAssetDto) {
    return this.investmentsService.createAsset(userId, dto);
  }

  @Get('assets/:id')
  getAsset(@User('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.getAsset(userId, id);
  }

  @Patch('assets/:id')
  updateAsset(
    @User('userId') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInvestmentAssetDto,
  ) {
    return this.investmentsService.updateAsset(userId, id, dto);
  }

  @Delete('assets/:id')
  deleteAsset(@User('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.deleteAsset(userId, id);
  }

  // -----------------------------
  // Valuations
  // -----------------------------
  @Get('valuations')
  listValuations(
    @User('userId') userId: number,
    @Query('assetId') assetId?: string,
  ) {
    const parsed = assetId ? Number(assetId) : undefined;
    return this.investmentsService.listValuations(userId, parsed);
  }

  @Post('valuations')
  createValuation(@User('userId') userId: number, @Body() dto: CreateInvestmentValuationDto) {
    return this.investmentsService.createValuation(userId, dto);
  }

  @Patch('valuations/:id')
  updateValuation(
    @User('userId') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInvestmentValuationDto,
  ) {
    return this.investmentsService.updateValuation(userId, id, dto);
  }

  @Delete('valuations/:id')
  deleteValuation(@User('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.deleteValuation(userId, id);
  }

  // -----------------------------
  // Summary + charts
  // -----------------------------
  @Get('summary')
  summary(@User('userId') userId: number) {
    return this.investmentsService.getSummary(userId);
  }

  @Get('assets/:id/series')
  assetSeries(@User('userId') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.getAssetSeries(userId, id);
  }
}
