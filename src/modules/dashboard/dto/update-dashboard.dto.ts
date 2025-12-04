import { PartialType } from '@nestjs/mapped-types';
import { FilterDashboardDto } from './filter-dashboard.dto';

export class UpdateDashboardDto extends PartialType(FilterDashboardDto) {}
