import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { User } from '../../common/decorators/user.decorator';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@User('userId') userId: number, @Body() dto: CreateTransactionDto) {
    return this.transactionsService.create(userId, dto);
  }

  @Get()
  findAll(
    @User('userId') userId: number,
    @Query() query: any, 
  ) {
    const filters = {
      walletId: query.walletId ? Number(query.walletId) : undefined,
      dateFrom: query.dateFrom || undefined,
      dateTo: query.dateTo || undefined,
      type: query.type || undefined,
      subcategoryId: query.subcategoryId ? Number(query.subcategoryId) : undefined,
    };
  
    return this.transactionsService.findAll(userId, filters);
  }
  

  @Get(':id')
  findOne(@User('userId') userId: number, @Param('id') id: string) {
    return this.transactionsService.findOne(userId, +id);
  }

  @Patch(':id')
  update(
    @User('userId') userId: number,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(userId, +id, dto);
  }

  @Delete(':id')
  remove(@User('userId') userId: number, @Param('id') id: string) {
    return this.transactionsService.remove(userId, +id);
  }
}
