import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { TransactionsService } from './transactions.service';

@Injectable()
export class TransactionsRecurringScheduler {
  private readonly logger = new Logger(TransactionsRecurringScheduler.name);

  constructor(private readonly transactionsService: TransactionsService) {}

  // Ejecutar cada minuto, en el segundo 0
  @Cron('0 * * * * *') // formato: sec min hour day month dayOfWeek
  async handleRecurringTransactions() {
    try {
      // Opcional: log si quieres ver que se dispara
      this.logger.debug('Procesando transacciones recurrentes...');
      await this.transactionsService.processRecurringTransactions();
    } catch (error) {
      this.logger.error('Error al procesar transacciones recurrentes', error);
    }
  }
}
