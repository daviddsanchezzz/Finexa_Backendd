import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { User } from '../../common/decorators/user.decorator';
import { FinancialHealthService } from './financial-health.service';
import { UpdateFinancialProfileDto } from './dto/financial-profile.dto';
import { SimulateDto } from './dto/simulate.dto';

// Prefijo propio: /health ya es el chequeo de vida del servidor.
@Controller('financial-health')
export class FinancialHealthController {
  constructor(private readonly service: FinancialHealthService) {}

  @Get()
  report(@User('id') userId: number) {
    return this.service.getReport(userId);
  }

  @Get('profile')
  getProfile(@User('id') userId: number) {
    return this.service.getProfile(userId);
  }

  @Put('profile')
  updateProfile(@User('id') userId: number, @Body() dto: UpdateFinancialProfileDto) {
    return this.service.updateProfile(userId, dto);
  }

  @Post('simulate')
  simulate(@User('id') userId: number, @Body() dto: SimulateDto) {
    return this.service.simulate(userId, dto);
  }
}
