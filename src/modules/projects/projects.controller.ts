import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { User } from 'src/common/decorators/user.decorator';
import { AttachProjectTransactionsDto } from './dto/attach-project-transactions.dto';
import { CreateProjectDto, UpdateProjectDto } from './dto/create-project.dto';
import {
  CreateProjectManualEntryDto,
  UpdateProjectManualEntryDto,
} from './dto/project-manual-entry.dto';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  create(@User('id') userId: number, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(userId, dto);
  }

  @Get()
  findAll(@User('id') userId: number) {
    return this.projectsService.findAll(userId);
  }

  @Get(':id')
  findOne(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@User('id') userId: number, @Param('id', ParseIntPipe) id: number) {
    return this.projectsService.remove(userId, id);
  }

  @Patch(':id/attach-transactions')
  attachTransactions(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachProjectTransactionsDto,
  ) {
    return this.projectsService.attachTransactions(userId, id, dto);
  }

  @Patch(':id/detach-transactions')
  detachTransactions(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AttachProjectTransactionsDto,
  ) {
    return this.projectsService.detachTransactions(userId, id, dto);
  }

  @Post(':id/manual-entries')
  createManualEntry(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateProjectManualEntryDto,
  ) {
    return this.projectsService.createManualEntry(userId, id, dto);
  }

  @Patch(':id/manual-entries/:entryId')
  updateManualEntry(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseIntPipe) entryId: number,
    @Body() dto: UpdateProjectManualEntryDto,
  ) {
    return this.projectsService.updateManualEntry(userId, id, entryId, dto);
  }

  @Delete(':id/manual-entries/:entryId')
  removeManualEntry(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('entryId', ParseIntPipe) entryId: number,
  ) {
    return this.projectsService.removeManualEntry(userId, id, entryId);
  }
}

