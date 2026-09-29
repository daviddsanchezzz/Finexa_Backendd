import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { CurrencyService } from './currency.service';

// Endpoint fino para que el frontend pueda mostrar "esto en tu wallet son
// tantos euros" antes de guardar una transacción en una divisa distinta a la
// de la cartera. No requiere userId: el tipo de cambio es el mismo para
// todos, solo depende del par de divisas (y opcionalmente de la fecha).
@Controller('currency')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Get('rate')
  async getRate(@Query('from') from: string, @Query('to') to: string, @Query('date') date?: string) {
    const fromCode = (from || '').toUpperCase();
    const toCode = (to || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) {
      throw new BadRequestException('from/to deben ser códigos ISO 4217 de 3 letras');
    }

    const parsedDate = date ? new Date(date) : new Date();
    if (isNaN(parsedDate.getTime())) {
      throw new BadRequestException('date inválida');
    }

    // getHistoricalRate (a diferencia de getCurrentRate) pide el tipo en vivo
    // al proveedor y lo cachea si no hay fila para ese día — así funciona
    // para cualquier divisa que el usuario elija en el momento, no solo las
    // que ya se usan en alguna wallet/transacción existente (que son las
    // únicas que el cron diario precachea).
    const rate = await this.currency.getHistoricalRate(fromCode, toCode, parsedDate);

    return { from: fromCode, to: toCode, rate: rate.toNumber() };
  }
}
