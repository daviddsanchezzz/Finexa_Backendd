import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CreateSubcategoryDto } from './dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from './dto/update-subcategory.dto';

@Injectable()
export class SubcategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, dto: CreateSubcategoryDto) {
    const category = await this.prisma.category.findFirst({
      where: { id: dto.categoryId, OR: [{ userId }, { userId: null }], active: true },
    });
    if (!category) throw new NotFoundException('Category not found');
  
    return this.prisma.subcategory.create({ data: dto });
  }

  async findAll(categoryId: number) {
    return this.prisma.subcategory.findMany({
      where: { categoryId, active: true },
      orderBy: [
        { position: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  async findOne(id: number) {
    const sub = await this.prisma.subcategory.findFirst({ where: { id, active: true } });
    if (!sub) throw new NotFoundException('Subcategory not found');
    return sub;
  }

  async update(id: number, dto: UpdateSubcategoryDto) {
    await this.findOne(id);
    return this.prisma.subcategory.update({ where: { id }, data: dto });
  }

  async remove(id: number,deleteTx: boolean) {
    if(deleteTx){
      
    }else{
      await this.findOne(id);
      return this.prisma.subcategory.update({ where: { id }, data: { active: false } });
    }
  }
}
