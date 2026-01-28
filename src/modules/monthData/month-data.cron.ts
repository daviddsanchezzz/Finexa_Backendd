import { Injectable } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "src/common/prisma/prisma.service";
import { MonthDataService } from "./month-data.service";

@Injectable()
export class MonthDataCron {
  constructor(
    private prisma: PrismaService,
    private monthDataService: MonthDataService,
  ) {}

  // 1 de cada mes a las 00:05 UTC
@Cron("0 4 1 * *", { timeZone: "UTC" })
async closePreviousMonthForAllUsers() {
  const now = new Date();

  const prevMonthStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth() - 1,
    1,
  ));

  const users = await this.prisma.user.findMany({
    select: { id: true },
  });

  for (const user of users) {
    await this.monthDataService.closeMonthWithCron(
      user.id,
      prevMonthStart,
    );
  }
}
}
