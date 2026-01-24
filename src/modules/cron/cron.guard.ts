import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class CronGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const incoming = req.get('x-cron-secret'); // Express-safe
    const expected = process.env.CRON_SECRET;

    if (!incoming) {
      throw new UnauthorizedException('Missing x-cron-secret');
    }
    if (!expected) {
      throw new UnauthorizedException('CRON_SECRET not configured');
    }
    if (incoming !== expected) {
      throw new UnauthorizedException('Invalid cron secret');
    }

    return true;
  }
}
