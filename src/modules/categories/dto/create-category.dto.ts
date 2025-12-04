import { Type } from 'class-transformer';
import { IsString, IsOptional, IsNumber, IsArray, ArrayNotEmpty, IsInt } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  name: string;

  @IsString()
  type: string; 

  @IsOptional()
  @IsString()
  emoji?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsNumber()
  position: number;
}

export class ReorderCategoriesDto {
  @IsArray()
  @ArrayNotEmpty()
  @Type(() => Number)
  @IsInt({ each: true })
  order: number[];   // [id1, id2, id3...]

  @IsOptional()
  @IsString()
  type?: string; // 'income' | 'expense' (si quieres separar por tipo)
}
