import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { User } from '../../common/decorators/user.decorator';

type UpdateDeleteScope = 'single' | 'series' | 'future';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@User('id') userId: number, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(userId, dto);
  }

  @Get('last-salary')
  findLastSalary(@User('id') userId: number) {
    return this.transactionsService.findLastSalary(userId);
  }

  @Get()
  findAll(
    @User('id') userId: number,
    @Query() query: any, 
  ) {
    const filters = {
      walletId: query.walletId ? Number(query.walletId) : undefined,
      dateFrom: query.dateFrom || undefined,
      dateTo: query.dateTo || undefined,
      type: query.type || undefined,
      subcategoryId: query.subcategoryId ? Number(query.subcategoryId) : undefined,
      isRecurring: query.isRecurring ? query.isRecurring === 'true' : undefined,
      investmentAssetId: query.investmentAssetId ? Number(query.investmentAssetId) : undefined,
    };
  
    return this.transactionsService.findAll(userId, filters);
  }
  

  @Get(':id')
  findOne(@User('id') userId: number, @Param('id') id: string) {
    return this.transactionsService.findOne(userId, +id);
  }



  @Patch(':id')
  update(
    @User('id') userId: number,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
    @Query('scope') scope: UpdateDeleteScope = 'single',
  ) {
    return this.transactionsService.updateWithScope(userId, +id, dto, scope);
  }

  @Delete(':id')
  remove(
    @User('id') userId: number,
    @Param('id') id: string,
    @Query('scope') scope: UpdateDeleteScope = 'single',
  ) {
    return this.transactionsService.removeWithScope(userId, +id, scope);
  }
}
