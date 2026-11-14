import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { VidaIntegrationGuard } from './vida-integration.guard';
import { VidaIntegrationService } from './vida-integration.service';

/**
 * API de solo lectura para miVida. Autenticación propia (token de integración), no el JWT de usuario.
 * Solo hay GET: este módulo no puede modificar nada en Finexa.
 */
@Public()
@UseGuards(VidaIntegrationGuard)
@Controller('integrations/vida')
export class VidaIntegrationController {
  constructor(private readonly service: VidaIntegrationService) {}

  @Get('ping') ping() { return this.service.ping(); }
  @Get('overview') overview(@Query('month') month?: string) { return this.service.overview(month); }
  @Get('transactions') transactions(@Query('month') month?: string, @Query('limit') limit?: string, @Query('type') type?: string) {
    return this.service.transactions({ month, limit: limit ? Number(limit) : undefined, type });
  }
  @Get('stats') stats(@Query('month') month?: string) { return this.service.stats(month); }
  @Get('investments') investments() { return this.service.investmentsSummary(); }
  @Get('budgets') budgets() { return this.service.budgetsOverview(); }
  @Get('goals') goals() { return this.service.goalsOverview(); }
  @Get('debts') debts() { return this.service.debtsOverview(); }
  @Get('recurring') recurring() { return this.service.recurring(); }
}
