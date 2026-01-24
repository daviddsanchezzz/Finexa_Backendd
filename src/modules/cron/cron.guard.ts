// src/common/guards/cron.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class CronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const secret = req.headers['x-cron-secret'];

    if (!secret || secret !== process.env.CRON_SECRET) {
      throw new UnauthorizedException('Invalid cron secret');
    }

    return true;
  }
}
