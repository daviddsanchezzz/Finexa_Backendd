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
  Put,
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
import { BuyAssetDto } from './dto/buy-asset.dto';
import { ListPortfolioSnapshotsQueryDto } from './dto/portfolio-snapshot.dto';
import { InvestmentExposureService } from './investment-exposure.service';
import { ManualAssetMetadataDto } from './dto/manual-asset-metadata.dto';
import { UpsertCompositionDto } from './dto/upsert-composition.dto';
import { UpsertInvestmentTargetsDto } from './dto/upsert-investment-targets.dto';
import { RebalancePreviewDto } from './dto/rebalance-preview.dto';
import { ContributionPreviewDto } from './dto/contribution-preview.dto';
import { CreateInvestmentValuationsBatchDto } from './dto/create-valuations-batch.dto';

@Controller('investments')
export class InvestmentsController {
  constructor(
    private readonly investmentsService: InvestmentsService,
    private readonly investmentExposureService: InvestmentExposureService,
  ) {}

  
  @Get('snapshots')
  async listSnapshots(@User('id') userId: number, @Query() q: ListPortfolioSnapshotsQueryDto) {
    return this.investmentsService.listMonthlySnapshots(userId, q);
  }
  // -----------------------------
  // Assets
  // -----------------------------
  @Get('assets')
  listAssets(@User('id') userId: number) {
    return this.investmentsService.listAssets(userId);
  }

  @Get('assets/archived')
  listArchivedAssets(@User('id') userId: number) {
    return this.investmentsService.listArchivedAssets(userId);
  }

  // -----------------------------
// Operations (InvestmentOperation)
// -----------------------------
@Get('operations')
listOperations(
  @User('id') userId: number,
  @Query('assetId') assetId?: string,
  @Query('active') active?: string,
) {
  let parsedAssetId: number | undefined = undefined;
  if (assetId !== undefined) {
    parsedAssetId = Number(assetId);
    if (!Number.isInteger(parsedAssetId)) {
      throw new BadRequestException('assetId inválido');
    }
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
  createAsset(@User('id') userId: number, @Body() dto: CreateInvestmentAssetDto) {
    return this.investmentsService.createAsset(userId, dto);
  }

  @Get('assets/:id')
  getAsset(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.getAsset(userId, id);
  }

  @Patch('assets/:id')
  updateAsset(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInvestmentAssetDto,
  ) {
    return this.investmentsService.updateAsset(userId, id, dto);
  }

  @Delete('assets/:id')
  deleteAsset(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.deleteAsset(userId, id);
  }

  @Patch('assets/:id/archive')
  archiveAsset(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.archiveAsset(userId, id);
  }

  @Patch('assets/:id/unarchive')
  unarchiveAsset(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.unarchiveAsset(userId, id);
  }

  // -----------------------------
  // Valuations
  // -----------------------------
@Get('valuations')
listValuations(@User('id') userId: number, @Query('assetId') assetId?: string) {
  if (assetId !== undefined) {
    const parsed = Number(assetId);
    if (!Number.isInteger(parsed)) throw new BadRequestException('assetId inválido');
    return this.investmentsService.listValuations(userId, parsed);
  }
  return this.investmentsService.listValuations(userId);
}

  @Get("valuations/:id")
  getValuation(
    @User("id") userId: number,
    @Param("id", ParseIntPipe) id: number
  ) {
    return this.investmentsService.getValuationById(userId, id);
  }


  @Post('valuations')
  createValuation(@User('id') userId: number, @Body() dto: CreateInvestmentValuationDto) {
    return this.investmentsService.createValuation(userId, dto);
  }

  @Post('valuations/batch')
  createValuationsBatch(@User('id') userId: number, @Body() dto: CreateInvestmentValuationsBatchDto) {
    return this.investmentsService.createValuationsBatch(userId, dto);
  }

  @Patch('valuations/:id')
  updateValuation(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInvestmentValuationDto,
  ) {
    return this.investmentsService.updateValuation(userId, id, dto);
  }

  @Delete('valuations/:id')
  deleteValuation(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.deleteValuation(userId, id);
  }

  // -----------------------------
  // Summary + charts
  // -----------------------------
  @Get('summary')
  summary(@User('id') userId: number) {
    return this.investmentsService.getSummary(userId);
  }

  @Get('exposure')
  exposure(@User('id') userId: number) {
    return this.investmentExposureService.getExposure(userId);
  }

  @Get('targets')
  listTargets(@User('id') userId: number) {
    return this.investmentExposureService.listInvestmentTargets(userId);
  }

  @Put('targets')
  upsertTargets(@User('id') userId: number, @Body() dto: UpsertInvestmentTargetsDto) {
    return this.investmentExposureService.upsertInvestmentTargets(userId, dto);
  }

  @Post('rebalance/preview')
  rebalancePreview(@User('id') userId: number, @Body() dto: RebalancePreviewDto) {
    return this.investmentExposureService.previewRebalance(userId, dto);
  }

  @Post('contribution/preview')
  contributionPreview(@User('id') userId: number, @Body() dto: ContributionPreviewDto) {
    return this.investmentExposureService.previewContribution(userId, dto);
  }

  @Get('assets/:id/metadata')
  assetMetadata(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentExposureService.getAssetMetadata(userId, id);
  }

  @Post('assets/:id/metadata/sync')
  syncAssetMetadata(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentExposureService.syncMetadataForAsset(userId, id);
  }

  @Post('assets/:id/metadata/manual')
  upsertManualAssetMetadata(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ManualAssetMetadataDto,
  ) {
    return this.investmentExposureService.upsertManualMetadata(userId, id, dto);
  }

  @Get('assets/:id/composition')
  getComposition(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentExposureService.getComposition(userId, id);
  }

  @Put('assets/:id/composition')
  upsertComposition(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertCompositionDto,
  ) {
    return this.investmentExposureService.upsertComposition(userId, id, dto);
  }

  @Post('metadata/sync-all')
  syncAllMetadata(@User('id') userId: number) {
    return this.investmentExposureService.syncMetadataForUser(userId);
  }

  @Get('assets/:id/series')
  assetSeries(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.investmentsService.getAssetSeries(userId, id);
  }

@Get('timeline')
timeline(
  @User('id') userId: number,
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
    @User('id') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: BuyAssetDto,
  ) {
    return this.investmentsService.buyAsset(userId, Number(assetId), dto);
  }

  @Post(':assetId/withdraw')
  withdraw(
    @User('id') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: SellAssetDto,
  ) {
    return this.investmentsService.sellAsset(userId, Number(assetId), dto);
  }

  @Post(':assetId/buy')
  buy(
    @User('id') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: BuyAssetDto,
  ) {
    return this.investmentsService.buyAsset(userId, Number(assetId), dto);
  }

  @Post(':assetId/sell')
  sell(
    @User('id') userId: number,
    @Param('assetId') assetId: string,
    @Body() dto: SellAssetDto,
  ) {
    return this.investmentsService.sellAsset(userId, Number(assetId), dto);
  }

  @Post('swap')
  swap(@User('id') userId: number, @Body() dto: SwapAssetsDto) {
    return this.investmentsService.swapAssets(userId, dto);
  }

  @Delete('swaps/:swapGroupId')
  deleteSwap(@User('id') userId: number, @Param('swapGroupId') swapGroupId: string) {
    return this.investmentsService.deleteSwap(userId, swapGroupId);
  }

  @Patch('swaps/:swapGroupId')
  updateSwap(
    @User('id') userId: number,
    @Param('swapGroupId') swapGroupId: string,
    @Body() dto: any,
  ) {
    return this.investmentsService.updateSwap(userId, swapGroupId, dto);
  }

  @Delete('operations/:id')
  deleteOperation(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.investmentsService.deleteOperation(userId, id);
  }

  @Patch('operations/:id')
  updateOperation(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: any,
  ) {
    return this.investmentsService.updateOperation(userId, id, dto);
  }
}
