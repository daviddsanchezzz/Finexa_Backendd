import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FinanceModuleKeyDto } from './dto/pin-finance-tab.dto';
import { UserDocumentTypeDto, UpsertUserDocumentDto } from './dto/user-document.dto';

const DEFAULT_PINNED_FINANCE_TAB = FinanceModuleKeyDto.INVESTMENTS;

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany();
  }

  async getPinnedFinanceTab(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { pinnedFinanceTabModuleKey: true },
    });
    return { moduleKey: user?.pinnedFinanceTabModuleKey ?? DEFAULT_PINNED_FINANCE_TAB };
  }

  async setPinnedFinanceTab(userId: number, moduleKey: FinanceModuleKeyDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { pinnedFinanceTabModuleKey: moduleKey },
      select: { pinnedFinanceTabModuleKey: true },
    });
    return { moduleKey: user.pinnedFinanceTabModuleKey };
  }

  async getUserDocuments(userId: number) {
    return this.prisma.userDocument.findMany({ where: { userId } });
  }

  async upsertUserDocument(userId: number, type: UserDocumentTypeDto, dto: UpsertUserDocumentDto) {
    return this.prisma.userDocument.upsert({
      where: { userId_type: { userId, type } },
      create: {
        userId,
        type,
        country: dto.country,
        documentNumber: dto.documentNumber ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      },
      update: {
        country: dto.country,
        documentNumber: dto.documentNumber ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      },
    });
  }

  async deleteUserDocument(userId: number, type: UserDocumentTypeDto) {
    await this.prisma.userDocument.deleteMany({ where: { userId, type } });
    return { success: true };
  }
}
