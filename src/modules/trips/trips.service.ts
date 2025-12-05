// trips/trips.service.ts
import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { CreateTripDto, UpdateTripDto } from "./dto/create-trip.dto";
import { CreateTripPlanItemDto } from "./dto/create-trip-plan-item.dto";
import { AttachTransactionsDto } from "./dto/attach-transactions.dto";

@Injectable()
export class TripsService {
  constructor(private prisma: PrismaService) {}

  async createTrip(userId: number, dto: CreateTripDto) {
    return this.prisma.trip.create({
      data: {
        userId,
        name: dto.name,
        destination: dto.destination,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        companions: dto.companions ?? [],
        emoji: dto.emoji,
        budget: dto.budget,
        cost: dto.cost,
      },
    });
  }

  async getTrips(userId: number) {
    return this.prisma.trip.findMany({
      where: { userId },
      orderBy: { startDate: "desc" },
    });
  }

  async getTripDetail(userId: number, tripId: number) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, userId },
      include: {
        planItems: { orderBy: { date: "asc" } },
        transactions: true,
      },
    });

    if (!trip) throw new NotFoundException("Trip not found");
    return trip;
  }

  async updateTrip(userId: number, tripId: number, dto: UpdateTripDto) {
    const existing = await this.prisma.trip.findFirst({
      where: { id: tripId, userId },
    });
    if (!existing) throw new ForbiddenException();

    return this.prisma.trip.update({
      where: { id: tripId },
      data: {
        ...dto,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        endDate: dto.endDate ? new Date(dto.endDate) : undefined,
      },
    });
  }

  async deleteTrip(userId: number, tripId: number) {
    const existing = await this.prisma.trip.findFirst({
      where: { id: tripId, userId },
    });
    if (!existing) throw new ForbiddenException();

    // primero despegar transacciones (opcional)
    await this.prisma.transaction.updateMany({
      where: { tripId },
      data: { tripId: null },
    });

    return this.prisma.trip.delete({
      where: { id: tripId },
    });
  }

private async recomputeTripPlannedCost(tripId: number) {
    const items = await this.prisma.tripPlanItem.findMany({
      where: { tripId },
      select: { cost: true },
    });

    const total = items.reduce((sum, item) => sum + (item.cost || 0), 0);

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { cost: total },
    });
  }


async addPlanItem(userId: number, tripId: number, dto: CreateTripPlanItemDto) {
  const trip = await this.prisma.trip.findFirst({
    where: { id: tripId, userId },
  });
  if (!trip) throw new ForbiddenException();

  const item = await this.prisma.tripPlanItem.create({
    data: {
      tripId,
      type: dto.type,
      title: dto.title,
      date: dto.date ? new Date(dto.date) : null,
      startTime: dto.startTime ? new Date(dto.startTime) : null,
      endTime: dto.endTime ? new Date(dto.endTime) : null,
      location: dto.location ?? null,
      notes: dto.notes ?? null,
      transactionId: dto.transactionId ?? null,
      cost: dto.cost ?? null,
    },
  });

  // 👇 actualizar coste total del viaje
  await this.recomputeTripPlannedCost(tripId);

  return item;
}

async updatePlanItem(
  userId: number,
  tripId: number,
  planItemId: number,
  dto: CreateTripPlanItemDto,
) {
  // comprobar que el plan pertenece al usuario y al viaje
  const existing = await this.prisma.tripPlanItem.findFirst({
    where: {
      id: planItemId,
      tripId,
      trip: { userId },
    },
  });
  if (!existing) throw new ForbiddenException();

  const updated = await this.prisma.tripPlanItem.update({
    where: { id: planItemId },
    data: {
      type: dto.type,
      title: dto.title,
      date: dto.date ? new Date(dto.date) : null,
      startTime: dto.startTime ? new Date(dto.startTime) : null,
      endTime: dto.endTime ? new Date(dto.endTime) : null,
      location: dto.location ?? null,
      notes: dto.notes ?? null,
      transactionId: dto.transactionId ?? null,
      cost: dto.cost ?? null,
    },
  });

  // 👇 recalcular coste del viaje
  await this.recomputeTripPlannedCost(tripId);

  return updated;
}

  async attachTransactions(userId: number, tripId: number, dto: AttachTransactionsDto) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, userId },
    });
    if (!trip) throw new ForbiddenException();

    await this.prisma.transaction.updateMany({
      where: {
        id: { in: dto.transactionIds },
        userId,
      },
      data: {
        tripId,
      },
    });

    return { success: true };
  }

  async deletePlanItem(userId: number, tripId: number, planItemId: number) {
  const existing = await this.prisma.tripPlanItem.findFirst({
    where: {
      id: planItemId,
      tripId,
      trip: { userId },
    },
  });
  if (!existing) throw new ForbiddenException();

  await this.prisma.tripPlanItem.delete({
    where: { id: planItemId },
  });

  // 👇 recalcular coste del viaje
  await this.recomputeTripPlannedCost(tripId);

  return { success: true };
}


  async detachTransactions(userId: number, tripId: number, dto: AttachTransactionsDto) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, userId },
    });
    if (!trip) throw new ForbiddenException();

    await this.prisma.transaction.updateMany({
      where: {
        id: { in: dto.transactionIds },
        userId,
        tripId,
      },
      data: { tripId: null },
    });

    return { success: true };
  }
}
