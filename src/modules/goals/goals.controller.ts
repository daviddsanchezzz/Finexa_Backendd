import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put } from '@nestjs/common';
import { User } from '../../common/decorators/user.decorator';
import { CreateGoalDto, GoalStatusDto, ManualEntryDto, SetAllocationsDto, UpdateGoalDto } from './dto/goal.dto';
import { GoalsService } from './goals.service';

@Controller('goals')
export class GoalsController {
  constructor(private readonly goals: GoalsService) {}

  @Get() list(@User('id') userId: number) { return this.goals.findAll(userId); }
  @Get('wallets') wallets(@User('id') userId: number) { return this.goals.wallets(userId); }
  @Get(':id') detail(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) { return this.goals.findOne(userId, id); }
  @Post() create(@User('id') userId: number, @Body() dto: CreateGoalDto) { return this.goals.create(userId, dto); }
  @Patch(':id') update(@User('id') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateGoalDto) { return this.goals.update(userId, id, dto); }
  @Patch(':id/status') status(@User('id') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: GoalStatusDto) { return this.goals.setStatus(userId, id, dto.status); }
  @Put(':id/allocations') allocations(@User('id') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: SetAllocationsDto) { return this.goals.setAllocations(userId, id, dto.allocations); }
  @Post(':id/manual-entries') addEntry(@User('id') userId: number, @Param('id', ParseIntPipe) id: number, @Body() dto: ManualEntryDto) { return this.goals.manualEntry(userId, id, dto); }
  @Patch(':id/manual-entries/:entryId') editEntry(@User('id') userId: number, @Param('id', ParseIntPipe) id: number, @Param('entryId', ParseIntPipe) entryId: number, @Body() dto: ManualEntryDto) { return this.goals.manualEntry(userId, id, dto, entryId); }
  @Delete(':id/manual-entries/:entryId') deleteEntry(@User('id') userId: number, @Param('id', ParseIntPipe) id: number, @Param('entryId', ParseIntPipe) entryId: number) { return this.goals.removeManualEntry(userId, id, entryId); }
  @Delete(':id') remove(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) { return this.goals.remove(userId, id); }
}
