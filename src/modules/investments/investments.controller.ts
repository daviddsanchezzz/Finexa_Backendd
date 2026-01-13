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
} from '@nestjs/common';
import { InvestmentsService } from './investments.service';
import { CreateInvestmentAssetDto } from './dto/create-investment-asset.dto';
import { UpdateInvestmentAssetDto } from './dto/update-investment-asset.dto';
import { CreateInvestmentValuationDto } from './dto/create-valuation.dto';
import { UpdateInvestmentValuationDto } from './dto/update-valuation.dto';
import { User } from 'src/common/decorators/user.decorator';
import { SellAssetDto } from './dto/sell-asset.dto';
import { SwapAssetsDto } from './dto/swap-assets.dto';
import { DepositAssetDto } from './dto/deposit-asset.dto';
import { WithdrawAssetDto } from './dto/withdraw-asset.dto';
import { BuyAssetDto } from './dto/buy-asset.dto';

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

  // -----------------------------
// Operations (InvestmentOperation)
// -----------------------------
@Get('operations')
listOperations(
  @User('userId') userId: number,
  @Query('assetId') assetId?: string,
  @Query('active') active?: string,
) {
  if (assetId === undefined) {
    throw new BadRequestException('assetId es requerido');
  }

  const parsedAssetId = Number(assetId);
  if (!Number.isInteger(parsedAssetId)) {
    throw new BadRequestException('assetId inválido');
  }

  let activeParsed: boolean | undefined = undefined;
  if (active !== undefined) {
    if (active === 'true') activeParsed = true;
    else if (active === 'false') activeParsed = false;
    else throw new BadRequestException('active inválido (true|false)');
  }

  return this.investmentsService.listOperations(userId, parsedAssetId, activeParsed);
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
listValuations(@User('userId') userId: number, @Query('assetId') assetId?: string) {
  if (assetId !== undefined) {
    const parsed = Number(assetId);
    if (!Number.isInteger(parsed)) throw new BadRequestException('assetId inválido');
    return this.investmentsService.listValuations(userId, parsed);
  }
  return this.investmentsService.listValuations(userId);
}

  @Get("valuations/:id")
  getValuation(
    @User("userId") userId: number,
    @Param("id", ParseIntPipe) id: number
  ) {
    return this.investmentsService.getValuationById(userId, id);
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

@Get('timeline')
timeline(
  @User('userId') userId: number,
  @Query('days') days?: string,
) {
  const n = Number(days);

  if (days !== undefined && !Number.isFinite(n)) {
    throw new BadRequestException('Invalid days');
  }

  return this.investmentsService.getPortfolioTimeline(userId, Number.isFinite(n) ? n : 90);
}


  // -----------------------------
  // Operations (separadas de transfers normales)
  // -----------------------------
  @Post(':assetId/deposit')
  deposit(
    @User('userId') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: DepositAssetDto,
  ) {
    return this.investmentsService.depositAsset(userId, Number(assetId), dto);
  }

  @Post(':assetId/withdraw')
  withdraw(
    @User('userId') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: WithdrawAssetDto,
  ) {
    return this.investmentsService.withdrawAsset(userId, Number(assetId), dto);
  }

  @Post(':assetId/buy')
  buy(
    @User('userId') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: BuyAssetDto,
  ) {
    return this.investmentsService.buyAsset(userId, Number(assetId), dto);
  }

  @Post(':assetId/sell')
  sell(
    @User('userId') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: SellAssetDto,
  ) {
    return this.investmentsService.sellAsset(userId, Number(assetId), dto);
  }

  @Post('swap')
  swap(@User('userId') userId: number, @Body() dto: SwapAssetsDto) {
    return this.investmentsService.swapAssets(userId, dto);
  }

  @Delete('swaps/:swapGroupId')
  deleteSwap(@User('userId') userId: number, @Param('swapGroupId') swapGroupId: string) {
    return this.investmentsService.deleteSwap(userId, swapGroupId);
  }

  @Get('portfolio/performance')
performance(
  @User('userId') userId: number,
  @Query('from') from: string, // "YYYY-MM"
  @Query('to') to: string,     // "YYYY-MM"
) {
  return this.investmentsService.getMonthlyPerformance(userId, from, to);
}


  @Patch('portfolio/snapshots/:id')
editPortfolioSnapshot(
  @User('userId') userId: number,
  @Param('id', ParseIntPipe) id: number,
  @Body() dto: { editedValue: number; note?: string },
) {
  return this.investmentsService.editPortfolioSnapshot(userId, id, dto);
}

}
