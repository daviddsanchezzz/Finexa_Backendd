import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FinanceModuleKeyDto } from './dto/pin-finance-tab.dto';

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
}
