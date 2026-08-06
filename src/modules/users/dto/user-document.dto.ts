import { IsDateString, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export const USER_DOCUMENT_TYPES = [
  'passport',
  'dni',
  'visa',
  'vaccine',
  'ehic',
  'private_health_insurance',
  'driving_license',
  'driving_license_international',
] as const;

export type UserDocumentType = (typeof USER_DOCUMENT_TYPES)[number];

export class CreateUserDocumentDto {
  @IsIn(USER_DOCUMENT_TYPES) type!: UserDocumentType;

  @IsOptional() @IsString() provider?: string;

  @IsOptional() @IsString() country?: string;

  @IsOptional() @IsString() documentNumber?: string;

  @IsOptional() @IsDateString() expiryDate?: string;

  @IsOptional() @IsObject() metadata?: Record<string, any>;

  @IsOptional() @IsString() fileUrl?: string;

  @IsOptional() @IsString() fileName?: string;

  @IsOptional() @IsString() fileMimeType?: string;
}

export class UpdateUserDocumentDto {
  @IsOptional() @IsString() provider?: string;

  @IsOptional() @IsString() country?: string;

  @IsOptional() @IsString() documentNumber?: string;

  @IsOptional() @IsDateString() expiryDate?: string;

  @IsOptional() @IsObject() metadata?: Record<string, any>;

  @IsOptional() @IsString() fileUrl?: string;

  @IsOptional() @IsString() fileName?: string;

  @IsOptional() @IsString() fileMimeType?: string;
}
