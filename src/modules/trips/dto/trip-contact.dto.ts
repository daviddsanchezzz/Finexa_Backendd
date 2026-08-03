import { IsOptional, IsString } from "class-validator";

export class CreateTripContactDto {
  @IsString() name: string;

  @IsString() phone: string;

  @IsOptional() @IsString() notes?: string;
}

export class UpdateTripContactDto {
  @IsOptional() @IsString() name?: string;

  @IsOptional() @IsString() phone?: string;

  @IsOptional() @IsString() notes?: string;
}
