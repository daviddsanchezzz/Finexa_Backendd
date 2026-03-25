import { PartialType } from '@nestjs/mapped-types';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ProjectDistributionLineDto {
  @IsString()
  @MinLength(1)
  partnerName: string;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateProjectProfitDistributionDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsNumber()
  @Min(0.01)
  totalAmount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProjectDistributionLineDto)
  lines: ProjectDistributionLineDto[];
}

export class UpdateProjectProfitDistributionDto extends PartialType(CreateProjectProfitDistributionDto) {}
