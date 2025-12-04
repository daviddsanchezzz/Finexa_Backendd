import { Controller, Get } from '@nestjs/common';
import { UserService } from './user.service';
import { User } from '../../common/decorators/user.decorator';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // (Opcional) Endpoint para listar todos los usuarios — solo si lo usas como admin
  @Get()
  findAll() {
    return this.userService.findAll();
  }
}
