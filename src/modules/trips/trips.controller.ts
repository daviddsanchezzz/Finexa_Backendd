// trips/trips.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Body, ParseIntPipe } from "@nestjs/common";
import { User } from "src/common/decorators/user.decorator";
import { TripsService } from "./trips.service";
import { CreateTripDto, UpdateTripDto } from "./dto/create-trip.dto";
import { CreateTripPlanItemDto } from "./dto/create-trip-plan-item.dto";
import { AttachTransactionsDto } from "./dto/attach-transactions.dto";
// asume que tienes un decorador @GetUser() que te da el userId

@Controller("trips")
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Post()
  createTrip(@User('id') userId: number, @Body() dto: CreateTripDto) {
    return this.tripsService.createTrip(userId, dto);
  }

  @Get()
  getTrips(@User('id') userId: number) {
    return this.tripsService.getTrips(userId);
  }

  @Get(":id")
  getTripDetail(@User('id') userId: number, @Param("id") id: string) {
    return this.tripsService.getTripDetail(userId, +id);
  }

  @Patch(":id")
  updateTrip(
    @User('id') userId: number,
    @Param("id") id: string,
    @Body() dto: UpdateTripDto
  ) {
    return this.tripsService.updateTrip(userId, +id, dto);
  }

  @Delete(":id")
  deleteTrip(@User('id') userId: number, @Param("id") id: string) {
    return this.tripsService.deleteTrip(userId, +id);
  }

  @Post(":id/plan-items")
  addPlanItem(
    @User('id') userId: number,
    @Param("id") id: string,
    @Body() dto: CreateTripPlanItemDto
  ) {
    return this.tripsService.addPlanItem(userId, +id, dto);
  }

@Patch(":tripId/plan-items/:planItemId")
  updatePlanItem(
    @User('id') userId: number,
    @Param("tripId") tripId: number,
    @Param("planItemId") planItemId: number,
    @Body() dto: CreateTripPlanItemDto
  ) {
  return this.tripsService.updatePlanItem(userId, tripId, planItemId, dto);
  }

  @Delete(':tripId/plan-items/:planItemId')
deletePlanItem(
    @User('id') userId: number,
  @Param('tripId') tripId: string,
  @Param('planItemId') planItemId: string,
) {
  return this.tripsService.deletePlanItem(
    userId,
    Number(tripId),
    Number(planItemId),
  );
}


  @Patch(":id/attach-transactions")
  attachTransactions(
    @User('id') userId: number,
    @Param("id") id: string,
    @Body() dto: AttachTransactionsDto
  ) {
    return this.tripsService.attachTransactions(userId, +id, dto);
  }

  @Patch(":id/detach-transactions")
  detachTransactions(
    @User('id') userId: number,
    @Param("id") id: string,
    @Body() dto: AttachTransactionsDto
  ) {
    return this.tripsService.detachTransactions(userId, +id, dto);
  }

  @Post(":id/export")
  async exportTrip(
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { includeExpenses: boolean },
  ) {
    const { includeExpenses } = body;

    const { base64, fileName } = await this.tripsService.exportTripToPdf(
      id,
      includeExpenses,
    );

    return {
      base64,
      fileName,
    };
  }

}
