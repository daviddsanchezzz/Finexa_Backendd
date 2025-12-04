import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BudgetsService } from './budgets.service';

@Injectable()
export class BudgetsCron {
  private readonly logger = new Logger(BudgetsCron.name);

  constructor(private budgetsService: BudgetsService) {}

  /**
   * Ejecuta cada hora → puedes cambiarlo a diario si quieres.
   */
@Cron('5 0 * * *') // 00:05 cada día
async handleCron() {
    this.logger.log('CRON: Revisando presupuestos...');

    const result = await this.budgetsService.processAutomaticClosures();

    this.logger.log(
      `CRON terminado → presupuestos procesados: ${result.processed}`,
    );
  }
}
