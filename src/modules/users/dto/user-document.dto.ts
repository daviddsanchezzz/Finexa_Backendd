import { IsDateString, IsOptional, IsString } from 'class-validator';

export enum UserDocumentTypeDto {
  PASSPORT = 'passport',
  DNI = 'dni',
}

export class UpsertUserDocumentDto {
  @IsString() country: string;

  @IsOptional() @IsString() documentNumber?: string;

  @IsOptional() @IsDateString() expiryDate?: string;
}
