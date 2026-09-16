import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ProjectPartnerDto {
  // Si se envía, actualiza ese socio existente (preservando su id y, por tanto,
  // el vínculo con sus movimientos de aportación/retirada ya registrados). Si
  // se omite, se crea un socio nuevo.
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @MinLength(1)
  name: string;

  @IsNumber()
  @Min(0.01)
  percentage: number;

  @IsOptional()
  @IsBoolean()
  isMe?: boolean;
}

export class UpsertProjectPartnersDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProjectPartnerDto)
  partners: ProjectPartnerDto[];
}

export class ProfitDistributionLineDto {
  @IsInt()
  partnerId: number;

  @IsNumber()
  @Min(0.01)
  amount: number;
}

export class DistributeProjectProfitDto {
  @IsNumber()
  @Min(0.01)
  totalAmount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProfitDistributionLineDto)
  lines: ProfitDistributionLineDto[];
}
