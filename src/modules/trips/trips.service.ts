// trips/trips.service.ts
import { Injectable, ForbiddenException, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { CreateTripDto, UpdateTripDto } from "./dto/create-trip.dto";
import { CreateTripPlanItemDto } from "./dto/create-trip-plan-item.dto";
import { AttachTransactionsDto } from "./dto/attach-transactions.dto";
import PDFDocument = require("pdfkit");

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

  async exportTripToPdf(tripId: number, includeExpenses: boolean) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        planItems: true,
        transactions: includeExpenses
          ? {
              include: {
                category: true,
                subcategory: true,
                wallet: true,
              },
            }
          : false,
      },
    });

    if (!trip) {
      throw new NotFoundException("Viaje no encontrado");
    }

    const pdfBuffer = await this.generateTripPdfMinimal(trip, includeExpenses);

    return {
      base64: pdfBuffer.toString("base64"),
      fileName: `viaje-${trip.id}.pdf`,
    };
  }

  private async generateTripPdfMinimal(trip: any, includeExpenses: boolean): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 40 });

        const buffers: Buffer[] = [];
        doc.on("data", (chunk) => buffers.push(chunk as Buffer));
        doc.on("end", () => {
          const result = Buffer.concat(buffers);
          resolve(result);
        });
        doc.on("error", (err) => {
          console.error("❌ Error dentro de PDFDocument:", err);
          reject(err);
        });

        // HEADER MUY SIMPLE
        doc.fontSize(20).text(trip.name || "Viaje", { underline: true });
        doc.moveDown();

        if (trip.destination) {
          doc.fontSize(12).text(`Destino: ${trip.destination}`);
        }

        doc.moveDown();

        // Fechas (sin toLocaleDateString para evitar líos de ICU)
        doc.fontSize(10).text(`Inicio: ${trip.startDate}`);
        doc.fontSize(10).text(`Fin: ${trip.endDate}`);

        if (trip.cost != null) {
          doc.moveDown();
          doc.fontSize(12).text(`Total gastado: ${trip.cost} €`);
        }

        // Planning mínimo
        doc.addPage();
        doc.fontSize(16).text("Planning", { underline: true });
        doc.moveDown();

        const planItems = Array.isArray(trip.planItems) ? trip.planItems : [];
        if (!planItems.length) {
          doc.fontSize(10).text("No hay elementos en el planning.");
        } else {
          planItems.forEach((item: any) => {
            doc.fontSize(12).text(item.title || "(Sin título)");
            if (item.date) doc.fontSize(10).text(`Fecha: ${item.date}`);
            if (item.location)
              doc.fontSize(10).text(`Ubicación: ${item.location}`);
            doc.moveDown(0.5);
          });
        }

        // Gastos mínimos
        if (includeExpenses && Array.isArray(trip.transactions) && trip.transactions.length) {
          doc.addPage();
          doc.fontSize(16).text("Gastos", { underline: true });
          doc.moveDown();

          trip.transactions.forEach((tx: any) => {
            doc
              .fontSize(11)
              .text(
                `${tx.date} - ${tx.amount} € - ${
                  tx.description || "Sin descripción"
                }`,
              );
          });
        }

        doc.end();
      } catch (e) {
        console.error("❌ Error en generateTripPdfMinimal:", e);
        reject(e);
      }
    });
  }
}
