// trips/trips.controller.ts
import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  ParseIntPipe,
  Query,
  HttpCode,
} from "@nestjs/common";
import { User } from "src/common/decorators/user.decorator";
import { TripsService } from "./trips.service";
import { CreateTripDto, UpdateTripDto } from "./dto/create-trip.dto";
import { CreateTripPlanItemDto, SetPaymentStatusDto } from "./dto/create-trip-plan-item.dto";
import { AttachTransactionsDto } from "./dto/attach-transactions.dto";
import { InviteTripMemberDto } from "./dto/invite-trip-member.dto";
import { AerodataboxService } from "./aviationstack.service";
import { CreateTripNoteDto, CreateTripTaskDto, TaskStatus, UpdateTripNoteDto, UpdateTripTaskDto } from "./dto/trip-notes-tasks.dto";
import { CreateTripDocumentDto, UpdateTripDocumentDto } from "./dto/trip-document.dto";
import { CreateTripContactDto, UpdateTripContactDto } from "./dto/trip-contact.dto";
import { CreateTripChecklistItemDto, UpdateTripChecklistItemDto, SeedTripChecklistDto } from "./dto/trip-checklist.dto";

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

  @Get("continents-stats")
getContinentsStats(@User("id") userId: number) {
  return this.tripsService.getContinentsStats(userId);
}


  @Get()
  getTrips(@User("id") userId: number, @Query("country") country?: string) {
    return this.tripsService.getTrips(userId, country);
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

// =========================================================
// Trip documents (ej. seguro de viaje)
// =========================================================

@Get(":tripId/documents")
async listDocuments(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.getTripDocuments(tripId);
}

@Post(":tripId/documents")
async createDocument(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: CreateTripDocumentDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.createTripDocument(tripId, dto);
}

@Patch(":tripId/documents/:id")
async updateDocument(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("id", ParseIntPipe) documentId: number,
  @Body() dto: UpdateTripDocumentDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.updateTripDocument(tripId, documentId, dto);
}

@Delete(":tripId/documents/:id")
async deleteDocument(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("id", ParseIntPipe) documentId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.deleteTripDocument(tripId, documentId);
}

// =========================================================
// Trip contacts
// =========================================================

@Get(":tripId/contacts")
async listContacts(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.listTripContacts(tripId);
}

@Post(":tripId/contacts")
async createContact(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: CreateTripContactDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.createTripContact(tripId, dto);
}

@Patch(":tripId/contacts/:contactId")
async updateContact(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("contactId", ParseIntPipe) contactId: number,
  @Body() dto: UpdateTripContactDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.updateTripContact(tripId, contactId, dto);
}

@Delete(":tripId/contacts/:contactId")
async deleteContact(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("contactId", ParseIntPipe) contactId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.deleteTripContact(tripId, contactId);
}

// =========================================================
// Trip checklist (Maleta)
// =========================================================

@Get(":tripId/checklist")
async listChecklist(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.listTripChecklist(tripId, userId);
}

@Post(":tripId/checklist/seed")
async seedChecklist(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: SeedTripChecklistDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.seedTripChecklist(tripId, userId, dto);
}

@Post(":tripId/checklist")
async createChecklistItem(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: CreateTripChecklistItemDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.createTripChecklistItem(tripId, userId, dto);
}

@Patch(":tripId/checklist/:itemId")
async updateChecklistItem(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("itemId", ParseIntPipe) itemId: number,
  @Body() dto: UpdateTripChecklistItemDto
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.updateTripChecklistItem(tripId, userId, itemId, dto);
}

@Delete(":tripId/checklist/:itemId")
async deleteChecklistItem(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("itemId", ParseIntPipe) itemId: number
) {
  await this.tripsService.assertTripOwnership(userId, tripId);
  return this.tripsService.deleteTripChecklistItem(tripId, userId, itemId);
}

// =========================================================
// Compañeros de viaje
// =========================================================

@Get(":tripId/members")
listMembers(@User("id") userId: number, @Param("tripId", ParseIntPipe) tripId: number) {
  return this.tripsService.listTripMembers(userId, tripId);
}

@Get(":tripId/invite-candidates")
listInviteCandidates(@User("id") userId: number, @Param("tripId", ParseIntPipe) tripId: number) {
  return this.tripsService.listTripInviteCandidates(userId, tripId);
}

@Post(":tripId/invite")
inviteMember(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Body() dto: InviteTripMemberDto
) {
  return this.tripsService.inviteTripMember(userId, tripId, dto);
}

@Delete(":tripId/members/:memberUserId")
@HttpCode(200)
removeMember(
  @User("id") userId: number,
  @Param("tripId", ParseIntPipe) tripId: number,
  @Param("memberUserId", ParseIntPipe) memberUserId: number
) {
  return this.tripsService.removeTripMember(userId, tripId, memberUserId);
}

@Get("invites/:memberId")
getInviteDetail(@User("id") userId: number, @Param("memberId", ParseIntPipe) memberId: number) {
  return this.tripsService.getTripInviteDetail(userId, memberId);
}

@Patch("invites/:memberId/accept")
@HttpCode(200)
acceptInvite(@User("id") userId: number, @Param("memberId", ParseIntPipe) memberId: number) {
  return this.tripsService.respondTripInvite(userId, memberId, true);
}

@Patch("invites/:memberId/reject")
@HttpCode(200)
rejectInvite(@User("id") userId: number, @Param("memberId", ParseIntPipe) memberId: number) {
  return this.tripsService.respondTripInvite(userId, memberId, false);
}

}
