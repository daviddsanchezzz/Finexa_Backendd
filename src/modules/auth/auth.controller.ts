import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() body: { email: string; password: string; name: string }) {
    return this.authService.register(body);
  }

  @Public()
  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() body: { refresh_token: string }) {
    return this.authService.refreshToken(body.refresh_token);
  }

  @Public()
  @Post('google')
  loginWithGoogle(@Body() body: { id_token: string }) {
    return this.authService.loginWithGoogle(body.id_token);
  }

  // Login silencioso desde el enlace del Atajo de iOS (ver User.quickAddToken)
  @Public()
  @Post('quick-add-token')
  loginWithQuickAddToken(@Body() body: { token: string }) {
    return this.authService.loginWithQuickAddToken(body.token);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getProfile(@Req() req) {
    const user = await this.authService.getProfile(req.user.id);
    return { user };
  }

}
