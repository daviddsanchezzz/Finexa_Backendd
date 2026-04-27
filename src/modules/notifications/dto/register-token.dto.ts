import { IsString, IsIn, IsOptional } from 'class-validator';

export class RegisterTokenDto {
  @IsString()
  token: string;

  @IsIn(['ios', 'android', 'web'])
  platform: 'ios' | 'android' | 'web';

  // Para web push: el objeto PushSubscription serializado en JSON
  @IsOptional()
  @IsString()
  webSubscription?: string;
}
