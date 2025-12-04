import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { SubcategoriesService } from './subcategories.service';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';
import { User } from '../../../common/decorators/user.decorator';

@Controller('categories/:categoryId/subcategories')
export class SubcategoriesController {
  constructor(private readonly subcategoriesService: SubcategoriesService) {}

  @Post()
  create(
    @User('userId') userId: number,
    @Param('categoryId') categoryId: string,
    @Body() dto: CreateSubcategoryDto,
  ) {
    return this.subcategoriesService.create(userId, { ...dto, categoryId: +categoryId });
  }

  @Get()
  findAll(@Param('categoryId') categoryId: string) {
    return this.subcategoriesService.findAll(+categoryId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSubcategoryDto) {
    return this.subcategoriesService.update(+id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Query('deleteTransactions') deleteTransactions: string,) {
    const removeTx = deleteTransactions === 'true';
    return this.subcategoriesService.remove(+id, removeTx);
  }
}
