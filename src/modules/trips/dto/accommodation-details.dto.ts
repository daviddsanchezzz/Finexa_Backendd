// accommodation-details.dto.ts
import { IsInt, IsOptional, IsString, IsUrl, Min } from "class-validator";

export class AccommodationDetailsDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() country?: string;

  // llegan como ISO string desde el front
  @IsOptional() @IsString() checkInAt?: string;
  @IsOptional() @IsString() checkOutAt?: string;

  @IsOptional() @IsInt() @Min(0) guests?: number;
  @IsOptional() @IsInt() @Min(0) rooms?: number;

  @IsOptional() @IsString() bookingRef?: string;
  @IsOptional() @IsString() phone?: string;

  // si quieres permitir localhost:
  @IsOptional() @IsUrl({ require_tld: false }) website?: string;

  @IsOptional() metadata?: any;
}
