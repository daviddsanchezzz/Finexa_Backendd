// trips/trips.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  Query,
} from "@nestjs/common";
import { User } from "src/common/decorators/user.decorator";
import { TripsService } from "./trips.service";
import { CreateTripDto, UpdateTripDto } from "./dto/create-trip.dto";
import { CreateTripPlanItemDto, SetPaymentStatusDto } from "./dto/create-trip-plan-item.dto";
import { AttachTransactionsDto } from "./dto/attach-transactions.dto";
import { AerodataboxService } from "./aviationstack.service";
import { CreateTripNoteDto, CreateTripTaskDto, TaskStatus, UpdateTripNoteDto, UpdateTripTaskDto } from "./dto/trip-notes-tasks.dto";

@Controller("trips")
export class TripsController {
  constructor(
    private readonly tripsService: TripsService,
    private readonly aerodatabox: AerodataboxService
  ) {}

  @Post()
  createTrip(@User("id") userId: number, @Body() dto: CreateTripDto) {
    return this.tripsService.createTrip(userId, dto);
  }

  @Get("summary")
  getSummary(@User("id") userId: number) {
    return this.tripsService.getSummary(userId);
  }

  @Get()
  getTrips(@User("id") userId: number) {
    return this.tripsService.getTrips(userId);
  }

  @Get(":id")
  getTripDetail(@User("id") userId: number, @Param("id", ParseIntPipe) id: number) {
    return this.tripsService.getTripDetail(userId, id);
  }

  @Patch(":id")
  updateTrip(
    @User("id") userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: UpdateTripDto
  ) {
    return this.tripsService.updateTrip(userId, id, dto);
  }

  @Delete(":id")
  deleteTrip(@User("id") userId: number, @Param("id", ParseIntPipe) id: number) {
    return this.tripsService.deleteTrip(userId, id);
  }

  // ✅ Flight autofill (correct path)
@Post(":tripId/plan-items/flight/autofill")
async autofillFlight(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body()
  body: {
    flightNumber: string;
    date: string;
    currency:   string;  // opcional
    cost?: number;      // opcional
  }
) {
  await this.tripsService.assertTripOwnership(userId, tripId);

  return this.tripsService.createFlightPlanItemFromAutofill(
    userId,
    tripId,
    body,
  );
}

  @Post(":id/plan-items")
  addPlanItem(
    @User("id") userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: CreateTripPlanItemDto
  ) {
    return this.tripsService.addPlanItem(userId, id, dto);
  }

  @Patch(":tripId/plan-items/:planItemId")
  updatePlanItem(
    @User("id") userId: number,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Param("planItemId", ParseIntPipe) planItemId: number,
    @Body() dto: CreateTripPlanItemDto
  ) {
    return this.tripsService.updatePlanItem(userId, tripId, planItemId, dto);
  }

@Patch(":tripId/plan-items/:planItemId/payment-status")
async setPaymentStatus(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("planItemId", ParseIntPipe) planItemId: number,
  @Body() dto: SetPaymentStatusDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.setPaymentStatus(tripId, planItemId, dto.paymentStatus);
}



  @Delete(":tripId/plan-items/:planItemId")
  deletePlanItem(
    @User("id") userId: number,
    @Param("tripId", ParseIntPipe) tripId: number,
    @Param("planItemId", ParseIntPipe) planItemId: number
  ) {
    return this.tripsService.deletePlanItem(userId, tripId, planItemId);
  }

  @Patch(":id/attach-transactions")
  attachTransactions(
    @User("id") userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AttachTransactionsDto
  ) {
    return this.tripsService.attachTransactions(userId, id, dto);
  }

  @Patch(":id/detach-transactions")
  detachTransactions(
    @User("id") userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: AttachTransactionsDto
  ) {
    return this.tripsService.detachTransactions(userId, id, dto);
  }

  @Post(":id/export")
  async exportTrip(
    @User("id") userId: number,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: { includeExpenses: boolean }
  ) {
    // (opcional) ownership
    await this.tripsService.assertTripOwnership(userId, id);

    const { base64, fileName } = await this.tripsService.exportTripToPdf(
      id,
      body.includeExpenses
    );

    return { base64, fileName };
  }


  // List notes (opcional, pero MUY útil)
@Get(":tripId/notes")
async listNotes(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.listTripNotes(tripId);
}

@Post(":tripId/notes")
async createNote(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: CreateTripNoteDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.createTripNote(tripId, dto);
}

@Patch(":tripId/notes/:noteId")
async updateNote(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("noteId", ParseIntPipe) noteId: number,
  @Body() dto: UpdateTripNoteDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.updateTripNote(tripId, noteId, dto);
}

@Delete(":tripId/notes/:noteId")
async deleteNote(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("noteId", ParseIntPipe) noteId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.deleteTripNote(tripId, noteId);
}

// Toggle pinned (opcional pero cómodo)
@Patch(":tripId/notes/:noteId/pin")
async pinNote(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("noteId", ParseIntPipe) noteId: number,
  @Body() body: { pinned: boolean }
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.setTripNotePinned(tripId, noteId, !!body?.pinned);
}


// =========================================================
// TASKS
// =========================================================

// List tasks (opcional)
@Get(":tripId/tasks")
async listTasks(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Query("status") status?: TaskStatus
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.listTripTasks(tripId, status);
}

@Post(":tripId/tasks")
async createTask(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: CreateTripTaskDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.createTripTask(tripId, dto);
}

@Patch(":tripId/tasks/:taskId")
async updateTask(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("taskId", ParseIntPipe) taskId: number,
  @Body() dto: UpdateTripTaskDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.updateTripTask(tripId, taskId, dto);
}

@Delete(":tripId/tasks/:taskId")
async deleteTask(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("taskId", ParseIntPipe) taskId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.deleteTripTask(tripId, taskId);
}

// Toggle done rápido (opcional pero top UX)
@Patch(":tripId/tasks/:taskId/toggle")
async toggleTask(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("taskId", ParseIntPipe) taskId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.toggleTripTaskStatus(tripId, taskId);
}


}
