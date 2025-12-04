import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateCategoryDto, ReorderCategoriesDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, dto: CreateCategoryDto) {
    return this.prisma.category.create({
      data: { ...dto, userId },
    });
  }

  async findAll(userId: number) {
    return this.prisma.category.findMany({
      where: { OR: [{ userId }, { userId: null }], active: true },
      include: { subcategories: true },
      orderBy: [
        { position: 'asc' },
        { name: 'asc' },
      ],

    });
  }

  async findOne(userId: number, id: number) {
    const category = await this.prisma.category.findFirst({
      where: { id, OR: [{ userId }, { userId: null }], active: true },
      include: { subcategories: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(userId: number, id: number, dto: UpdateCategoryDto) {
    await this.findOne(userId, id);
    return this.prisma.category.update({ where: { id }, data: dto });
  }

  async remove(userId: number, id: number, deleteTx: boolean) {
    await this.findOne(userId, id);
    if(deleteTx){

    }else{
      return this.prisma.category.update({
          where: { id },
          data: { active: false },
      });
    }
  }

  async reorder(userId: number, dto: ReorderCategoriesDto) {
    const { order, type } = dto;
    console.log('dto', dto);
    console.log('order', order);
    if (!order || order.length === 0) {
      throw new BadRequestException('order no puede estar vacío');
    }
  
    // Solo categorías del usuario (puedes decidir qué hacer con las globales userId = null)
    const categories = await this.prisma.category.findMany({
      where: {
        active: true,
        userId,          // solo las del usuario
        ...(type ? { type } : {}),
        id: { in: order },
      },
      select: { id: true },
    });
  
    if (categories.length !== order.length) {
      throw new ForbiddenException('Algunas categorías no pertenecen al usuario actual');
    }
  
    await this.prisma.$transaction(
      order.map((id, index) =>
        this.prisma.category.update({
          where: { id },
          data: { position: index },
        }),
      ),
    );
  
    return this.prisma.category.findMany({
      where: {
        active: true,
        userId,
        ...(type ? { type } : {}),
      },
      orderBy: { position: 'asc' },
    });
  }
  
}
