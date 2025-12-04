import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { FilterDashboardDto } from './dto/filter-dashboard.dto';
import { User } from '../../common/decorators/user.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  getSummary(@User('userId') userId: number, @Query() filters: FilterDashboardDto) {
    return this.dashboardService.getSummary(userId, filters);
  }

  @Get('by-category')
  getByCategory(@User('userId') userId: number, @Query() filters: FilterDashboardDto) {
    return this.dashboardService.getByCategory(userId, filters);
  }

  @Get('trends')
  getTrends(@User('userId') userId: number, @Query() filters: FilterDashboardDto) {
    return this.dashboardService.getTrends(userId, filters);
  }
}
