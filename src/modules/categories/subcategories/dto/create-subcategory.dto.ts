import { IsString, IsNumber, IsOptional } from 'class-validator';

export class CreateSubcategoryDto {
  @IsString()
  name: string;

  @IsNumber()
  categoryId: number;

  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsNumber()
  position: number;
}
