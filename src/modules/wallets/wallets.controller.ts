import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CreateWalletDto, ReorderWalletsDto } from './dto/create-wallet.dto';
import { UpdateWalletDto } from './dto/update-wallet.dto';
import { User } from '../../common/decorators/user.decorator';

@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Post()
  create(@User('userId') userId: number, @Body() dto: CreateWalletDto) {
    return this.walletsService.create(userId, dto);
  }

  @Get()
  findAll(@User('userId') userId: number) {
    return this.walletsService.findAll(userId);
  }

  @Get(':id')
  findOne(@User('userId') userId: number, @Param('id') id: string) {
    return this.walletsService.findOne(userId, +id);
  }

  // ⬇⬇⬇ MUEVE ESTO ARRIBA, ANTES DEL ':id'
  @Patch('reorder')
  reorder(@User('userId') userId: number, @Body() dto: ReorderWalletsDto) {
    return this.walletsService.reorder(userId, dto);
  }

  @Patch(':id')
  update(@User('userId') userId: number, @Param('id') id: string, @Body() dto: UpdateWalletDto) {
    return this.walletsService.update(userId, +id, dto);
  }

  @Delete(':id')
  remove(@User('userId') userId: number, @Param('id') id: string) {
    return this.walletsService.remove(userId, +id);
  }
}
