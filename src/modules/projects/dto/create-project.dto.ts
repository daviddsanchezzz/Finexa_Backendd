import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';

export enum ProjectStatusDto {
  idea = 'idea',
  active = 'active',
  paused = 'paused',
  completed = 'completed',
  cancelled = 'cancelled',
}

export class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  type?: string;

  @IsEnum(ProjectStatusDto)
  status: ProjectStatusDto;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}
