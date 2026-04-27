import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseIntPipe,
  HttpCode,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RegisterTokenDto } from './dto/register-token.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { User } from '../../common/decorators/user.decorator';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ── VAPID public key (para web push) ────────

  @Get('vapid-public-key')
  getVapidPublicKey() {
    return { key: process.env.VAPID_PUBLIC_KEY ?? '' };
  }

  // ── Tokens ──────────────────────────────────

  @Post('token')
  @HttpCode(200)
  registerToken(@User('id') userId: number, @Body() dto: RegisterTokenDto) {
    return this.notificationsService.registerToken(userId, dto);
  }

  @Delete('token')
  @HttpCode(200)
  removeToken(@User('id') userId: number, @Body('token') token: string) {
    return this.notificationsService.removeToken(userId, token);
  }

  // ── Preferencias ────────────────────────────

  @Get('preferences')
  getPreferences(@User('id') userId: number) {
    return this.notificationsService.getPreferences(userId);
  }

  @Put('preferences')
  updatePreferences(
    @User('id') userId: number,
    @Body() dto: UpdatePreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(userId, dto);
  }

  // ── Test (dispara una notificación real al usuario autenticado) ──

  @Post('test')
  @HttpCode(200)
  sendTest(@User('id') userId: number) {
    return this.notificationsService.sendTestNotification(userId);
  }

  // ── Historial in-app ─────────────────────────

  @Get()
  getNotifications(@User('id') userId: number) {
    return this.notificationsService.getNotifications(userId);
  }

  @Patch(':id/read')
  @HttpCode(200)
  markAsRead(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.notificationsService.markAsRead(userId, id);
  }

  @Patch('read-all')
  @HttpCode(200)
  markAllAsRead(@User('id') userId: number) {
    return this.notificationsService.markAllAsRead(userId);
  }
}
