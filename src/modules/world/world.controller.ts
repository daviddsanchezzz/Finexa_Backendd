import { Controller, Get, Patch, Param, Body } from "@nestjs/common";
import { User } from "src/common/decorators/user.decorator";
import { WorldService } from "./world.service";
import { UpdateWonderVisitDto } from "./dto/update-wonder-visit.dto";

@Controller("world")
export class WorldController {
  constructor(private readonly worldService: WorldService) {}

  @Get("overview")
  getOverview(@User("id") userId: number) {
    return this.worldService.getOverview(userId);
  }

  @Get("countries")
  getCountries(@User("id") userId: number) {
    return this.worldService.getCountries(userId);
  }

  @Get("wonders")
  getWonders(@User("id") userId: number) {
    return this.worldService.getWonders(userId);
  }

  @Patch("wonders/:key")
  updateWonder(
    @User("id") userId: number,
    @Param("key") key: string,
    @Body() dto: UpdateWonderVisitDto,
  ) {
    return this.worldService.upsertWonderVisit(userId, key, dto);
  }
}
