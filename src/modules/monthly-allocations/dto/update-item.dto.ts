import { IsEnum, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AllocationCategoryDto } from './create-item.dto';

export class UpdateAllocationItemDto {
  @IsOptional()
  @IsEnum(AllocationCategoryDto)
  category?: AllocationCategoryDto;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsNumber()
  order?: number;
}
