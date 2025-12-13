import { PartialType } from '@nestjs/mapped-types';
import { CreateInvestmentValuationDto } from './create-valuation.dto';

export class UpdateInvestmentValuationDto extends PartialType(CreateInvestmentValuationDto) {}
