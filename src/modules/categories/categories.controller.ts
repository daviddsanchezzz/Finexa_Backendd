import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, ReorderCategoriesDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { User } from '../../common/decorators/user.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Post()
  create(@User('userId') userId: number, @Body() dto: CreateCategoryDto) {
    return this.categoriesService.create(userId, dto);
  }

  @Get()
  findAll(@User('userId') userId: number) {
    return this.categoriesService.findAll(userId);
  }

  @Get(':id')
  findOne(@User('userId') userId: number, @Param('id') id: string) {
    return this.categoriesService.findOne(userId, +id);
  }

    @Patch('reorder')
  reorder(@User('userId') userId: number, @Body() dto: ReorderCategoriesDto) {
    return this.categoriesService.reorder(userId, dto);
  }

  @Patch(':id')
  update(
    @User('userId') userId: number,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categoriesService.update(userId, +id, dto);
  }

  @Delete(':id')
  remove(@User('userId') userId: number, @Param('id') id: string, @Query('deleteTransactions') deleteTransactions: string,
) {
    const removeTx = deleteTransactions === 'true';
    return this.categoriesService.remove(userId, +id, removeTx);
  }



}
