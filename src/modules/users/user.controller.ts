import { Body, Controller, Get, Patch } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from '../../common/decorators/user.decorator';
import { PinFinanceTabDto } from './dto/pin-finance-tab.dto';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // (Opcional) Endpoint para listar todos los usuarios — solo si lo usas como admin
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Get('me/pinned-finance-tab')
  getPinnedFinanceTab(@User('id') userId: number) {
    return this.userService.getPinnedFinanceTab(userId);
  }

  @Patch('me/pinned-finance-tab')
  setPinnedFinanceTab(@User('id') userId: number, @Body() dto: PinFinanceTabDto) {
    return this.userService.setPinnedFinanceTab(userId, dto.moduleKey);
  }
}
