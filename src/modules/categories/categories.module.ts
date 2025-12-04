import { Module } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { SubcategoriesService } from './subcategories/subcategories.service';
import { SubcategoriesController } from './subcategories/subcategories.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CategoriesController, SubcategoriesController],
  providers: [CategoriesService, SubcategoriesService],
})
export class CategoriesModule {}
