import { Body, Get, Param, Post, Put, Delete } from '@nestjs/common';
import { BaseCommand } from './base-command';

export abstract class BaseController<T> {
  constructor(protected readonly command: BaseCommand<T>) {}

  @Get()
  async findAll(): Promise<T[]> {
    return this.command.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string): Promise<T | null> {
    return this.command.findById(id);
  }

  @Post()
  async create(@Body() data: any): Promise<T> {
    return this.command.create(data);
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() data: any): Promise<T | null> {
    return this.command.update(id, data);
  }

  @Delete(':id')
  async delete(@Param('id') id: string): Promise<T | null> {
    return this.command.delete(id);
  }
}
