import { PartialType } from '@nestjs/mapped-types';
import { CreateInvestmentAssetDto } from './create-investment-asset.dto';

export class UpdateInvestmentAssetDto extends PartialType(CreateInvestmentAssetDto) {}
