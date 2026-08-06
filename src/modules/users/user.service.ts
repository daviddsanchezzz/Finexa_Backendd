import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FinanceModuleKeyDto } from './dto/pin-finance-tab.dto';
import { CreateUserDocumentDto, UpdateUserDocumentDto } from './dto/user-document.dto';

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
    const docs = await this.prisma.userDocument.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    // Los visados caducados no se muestran (en vez de marcarlos "caducado" los
    // ocultamos — un visado vencido ya no es útil para ningún viaje futuro).
    const now = Date.now();
    return docs.filter((d) => !(d.type === 'visa' && d.expiryDate != null && d.expiryDate.getTime() < now));
  }

  async createUserDocument(userId: number, dto: CreateUserDocumentDto) {
    return this.prisma.userDocument.create({
      data: {
        userId,
        type: dto.type,
        provider: dto.provider ?? null,
        country: dto.country ?? null,
        documentNumber: dto.documentNumber ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        metadata: dto.metadata ?? undefined,
        fileUrl: dto.fileUrl ?? null,
        fileName: dto.fileName ?? null,
        fileMimeType: dto.fileMimeType ?? null,
      },
    });
  }

  async updateUserDocument(userId: number, documentId: number, dto: UpdateUserDocumentDto) {
    const existing = await this.prisma.userDocument.findFirst({ where: { id: documentId, userId }, select: { id: true } });
    if (!existing) throw new NotFoundException('Document not found');

    const data: any = {};
    if (dto.provider !== undefined) data.provider = dto.provider ?? null;
    if (dto.country !== undefined) data.country = dto.country ?? null;
    if (dto.documentNumber !== undefined) data.documentNumber = dto.documentNumber ?? null;
    if (dto.expiryDate !== undefined) data.expiryDate = dto.expiryDate ? new Date(dto.expiryDate) : null;
    if (dto.metadata !== undefined) data.metadata = dto.metadata ?? null;
    if (dto.fileUrl !== undefined) data.fileUrl = dto.fileUrl ?? null;
    if (dto.fileName !== undefined) data.fileName = dto.fileName ?? null;
    if (dto.fileMimeType !== undefined) data.fileMimeType = dto.fileMimeType ?? null;

    return this.prisma.userDocument.update({ where: { id: documentId }, data });
  }

  async deleteUserDocument(userId: number, documentId: number) {
    await this.prisma.userDocument.deleteMany({ where: { id: documentId, userId } });
    return { success: true };
  }
}
