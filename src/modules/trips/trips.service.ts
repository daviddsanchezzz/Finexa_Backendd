// trips/trips.service.ts
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
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

  async addPlanItem(
    userId: number,
    tripId: number,
    dto: CreateTripPlanItemDto,
  ) {
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

  async attachTransactions(
    userId: number,
    tripId: number,
    dto: AttachTransactionsDto,
  ) {
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

  async detachTransactions(
    userId: number,
    tripId: number,
    dto: AttachTransactionsDto,
  ) {
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

  // =========================================================
  // EXPORTAR VIAJE A PDF (PROFESIONAL)
  // =========================================================

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

  // PDF "minimal" ahora es un PDF PRO alineado con tu UI de gastos
  private async generateTripPdfMinimal(
    trip: any,
    includeExpenses: boolean,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: "A4", margin: 40 });

        const buffers: Buffer[] = [];
        doc.on("data", (chunk) => buffers.push(chunk as Buffer));
        doc.on("end", () => resolve(Buffer.concat(buffers)));
        doc.on("error", (err) => {
          console.error("❌ Error dentro de PDFDocument:", err);
          reject(err);
        });

        const primaryColor = trip.color || "#4F46E5";
        const planItems = Array.isArray(trip.planItems) ? trip.planItems : [];

        // =====================================================
        // PORTADA
        // =====================================================

        doc.rect(0, 0, doc.page.width, doc.page.height).fill(primaryColor);

        doc
          .fillColor("white")
          .font("Helvetica-Bold")
          .fontSize(60)
          .text(trip.emoji || "✈️", {
            align: "center",
          });

        doc.moveDown(2);

        doc
          .fontSize(28)
          .text(trip.name || "Viaje", {
            align: "center",
          });

        if (trip.destination) {
          doc.moveDown(0.5);
          doc
            .font("Helvetica")
            .fontSize(16)
            .fillColor("white")
            .text(trip.destination, {
              align: "center",
            });
        }

        const dateRange = `${this.formatDate(trip.startDate)} — ${this.formatDate(
          trip.endDate,
        )}`;

        doc.moveDown(0.5);
        doc
          .fontSize(12)
          .fillColor("white")
          .text(dateRange, {
            align: "center",
          });

        doc.addPage();

        // =====================================================
        // RESUMEN
        // =====================================================

        const days = this.countDays(trip.startDate, trip.endDate);
        const itemsWithCost = planItems.filter(
          (i: any) => typeof i.cost === "number" && !isNaN(i.cost),
        );
        const plannedTotal = itemsWithCost.reduce(
          (sum: number, i: any) => sum + (i.cost || 0),
          0,
        );

        doc
          .font("Helvetica-Bold")
          .fontSize(22)
          .fillColor("#111827")
          .text("Resumen del viaje");

        this.drawDivider(doc);

        doc.font("Helvetica").fontSize(12).fillColor("#374151");
        doc.text(`Destino: ${trip.destination || "—"}`);
        doc.text(
          `Fechas: ${this.formatDate(trip.startDate)} - ${this.formatDate(
            trip.endDate,
          )}`,
        );
        doc.text(`Duración: ${days} día${days === 1 ? "" : "s"}`);
        doc.text(
          `Compañeros: ${
            Array.isArray(trip.companions) && trip.companions.length > 0
              ? trip.companions.join(", ")
              : "—"
          }`,
        );
        doc.text(
          `Total planning (suma de costes del planning): ${this.formatEuro(
            plannedTotal,
          )}`,
        );
        doc.text(
          `Total viaje (campo trip.cost): ${this.formatEuro(trip.cost || 0)}`,
        );

        doc.moveDown(1.2);

        // =====================================================
        // LOGÍSTICA (Vuelos / Alojamientos)
        // =====================================================

        doc
          .font("Helvetica-Bold")
          .fontSize(18)
          .fillColor("#111827")
          .text("Logística (vuelos y alojamiento)");

        this.drawDivider(doc);

        const logisticsItems = planItems.filter((i: any) =>
          ["flight", "accommodation"].includes(i.type),
        );

        if (!logisticsItems.length) {
          doc
            .font("Helvetica")
            .fontSize(11)
            .fillColor("#6B7280")
            .text("No hay vuelos ni alojamientos registrados.");
        } else {
          logisticsItems
            .sort((a: any, b: any) => {
              const da = a.date ? new Date(a.date).getTime() : 0;
              const db = b.date ? new Date(b.date).getTime() : 0;
              return da - db;
            })
            .forEach((item: any) => {
              this.ensureSpace(doc, 100);

              const cardX = 40;
              const cardY = doc.y;
              const cardWidth = doc.page.width - 80;
              const cardHeight = 80;

              doc
                .roundedRect(cardX, cardY, cardWidth, cardHeight, 10)
                .fill("#F9FAFB")
                .strokeColor("#E5E7EB")
                .lineWidth(1)
                .stroke();

              const label =
                item.type === "flight"
                  ? "✈️ Vuelo"
                  : item.type === "accommodation"
                  ? "🏨 Alojamiento"
                  : "Logística";

              doc
                .font("Helvetica-Bold")
                .fontSize(12)
                .fillColor("#111827")
                .text(label, cardX + 14, cardY + 10);

              doc
                .font("Helvetica")
                .fontSize(11)
                .fillColor("#1F2937")
                .text(item.title || "(Sin título)", cardX + 14, cardY + 26, {
                  width: cardWidth - 28,
                  ellipsis: true,
                });

              const dateLabel = item.date
                ? this.formatDateShort(item.date)
                : "Sin fecha";
              const timeLabel = item.startTime
                ? new Date(item.startTime).toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";

              doc
                .fontSize(10)
                .fillColor("#4B5563")
                .text(
                  `Fecha: ${dateLabel}${timeLabel ? " · " + timeLabel : ""}`,
                  cardX + 14,
                  cardY + 44,
                );

              if (item.location) {
                doc
                  .fontSize(10)
                  .fillColor("#6B7280")
                  .text(`Ubicación: ${item.location}`, cardX + 14, cardY + 58, {
                    width: cardWidth - 28,
                    ellipsis: true,
                  });
              }

              doc.moveDown(4);
            });
        }

        // =====================================================
        // PLANNING DÍA A DÍA (itinerario)
        // =====================================================

        doc.addPage();

        doc
          .font("Helvetica-Bold")
          .fontSize(18)
          .fillColor("#111827")
          .text("Planning día a día");

        this.drawDivider(doc);

        if (!planItems.length) {
          doc
            .font("Helvetica")
            .fontSize(11)
            .fillColor("#6B7280")
            .text("No hay elementos en el planning.");
        } else {
          const sortedItems = [...planItems].sort((a: any, b: any) => {
            const da = a.date ? new Date(a.date).getTime() : 0;
            const db = b.date ? new Date(b.date).getTime() : 0;
            if (da !== db) return da - db;
            const ta = a.startTime ? new Date(a.startTime).getTime() : 0;
            const tb = b.startTime ? new Date(b.startTime).getTime() : 0;
            return ta - tb;
          });

          const groupedByDate = this.groupBy(sortedItems, (i: any) =>
            i.date ? this.formatDate(i.date) : "Sin fecha",
          );

          Object.entries(groupedByDate).forEach(([dateLabel, items]) => {
            this.ensureSpace(doc, 80);

            doc
              .font("Helvetica-Bold")
              .fontSize(13)
              .fillColor("#111827")
              .text(dateLabel);
            doc.moveDown(0.3);

            (items as any[]).forEach((item) => {
              const timeLabel = item.startTime
                ? new Date(item.startTime).toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  }) + " · "
                : "";

              doc
                .font("Helvetica")
                .fontSize(11)
                .fillColor("#111827")
                .text(`• ${timeLabel}${item.title || "(Sin título)"}`, {
                  indent: 8,
                });

              if (item.location) {
                doc
                  .font("Helvetica")
                  .fontSize(10)
                  .fillColor("#6B7280")
                  .text(`   ${item.location}`, {
                    indent: 8,
                  });
              }

              if (item.cost != null) {
                doc
                  .font("Helvetica")
                  .fontSize(10)
                  .fillColor("#6B7280")
                  .text(`   Coste: ${this.formatEuro(item.cost)}`, {
                    indent: 8,
                  });
              }

              doc.moveDown(0.3);
            });

            doc.moveDown(0.6);
            this.drawDivider(doc);
          });
        }

        // =====================================================
        // GASTOS DEL VIAJE (PLANNING, ALINEADO CON TU UI)
        // =====================================================

        doc.addPage();

        doc
          .font("Helvetica-Bold")
          .fontSize(18)
          .fillColor("#111827")
          .text("Gastos del viaje (planning)");

        this.drawDivider(doc);

        if (!itemsWithCost.length) {
          doc
            .font("Helvetica")
            .fontSize(11)
            .fillColor("#6B7280")
            .text(
              "Aún no hay costes asignados en el planning de este viaje (igual que en la pantalla de gastos).",
            );
        } else {
          // ======= Mismas agrupaciones que TripExpensesSection =======

          type GroupId =
            | "flights"
            | "accommodation"
            | "transport"
            | "activities"
            | "food"
            | "shopping";

          const groupsConfig: {
            id: GroupId;
            label: string;
            emoji: string;
            types: string[];
          }[] = [
            {
              id: "flights",
              label: "Vuelos",
              emoji: "✈️",
              types: ["flight"],
            },
            {
              id: "accommodation",
              label: "Alojamiento",
              emoji: "🏨",
              types: ["accommodation"],
            },
            {
              id: "transport",
              label: "Transporte",
              emoji: "🚌",
              types: ["transport", "taxi"],
            },
            {
              id: "activities",
              label: "Actividades y visitas",
              emoji: "✨",
              types: [
                "museum",
                "monument",
                "viewpoint",
                "free_tour",
                "concert",
                "bar_party",
                "beach",
                "activity",
              ],
            },
            {
              id: "food",
              label: "Comida y bebida",
              emoji: "🍽️",
              types: ["restaurant"],
            },
            {
              id: "shopping",
              label: "Compras y otros",
              emoji: "🛒",
              types: ["shopping", "other"],
            },
          ];

          const getGroupForType = (type: string): GroupId => {
            const found = groupsConfig.find((g) => g.types.includes(type));
            return found?.id ?? "shopping";
          };

          const groupsMap: Record<
            GroupId,
            { total: number; items: any[] }
          > = {
            flights: { total: 0, items: [] },
            accommodation: { total: 0, items: [] },
            transport: { total: 0, items: [] },
            activities: { total: 0, items: [] },
            food: { total: 0, items: [] },
            shopping: { total: 0, items: [] },
          };

          for (const item of itemsWithCost) {
            const gId = getGroupForType(item.type);
            groupsMap[gId].items.push(item);
            groupsMap[gId].total += item.cost || 0;
          }

          const nonEmptyGroups = groupsConfig
            .map((g) => ({
              ...g,
              total: groupsMap[g.id].total,
              items: groupsMap[g.id].items,
            }))
            .filter((g) => g.items.length > 0)
            .sort((a, b) => b.total - a.total);

          const total = plannedTotal || 0;

          // Resumen general
          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .fillColor("#111827")
            .text(`Total planning: ${this.formatEuro(total)}`);
          doc.moveDown(0.5);

          // Distribución por categorías (tabla + barras)
          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .text("Distribución por categorías:");
          doc.moveDown(0.3);

          const barMaxWidth = doc.page.width - 200; // algo de margen

          nonEmptyGroups.forEach((g) => {
            this.ensureSpace(doc, 30);

            const pct = total > 0 ? (g.total / total) * 100 : 0;

            const startY = doc.y;

            doc
              .font("Helvetica")
              .fontSize(11)
              .fillColor("#374151")
              .text(`${g.emoji} ${g.label}`, 40, startY, { width: 120 });

            doc
              .font("Helvetica-Bold")
              .fontSize(11)
              .fillColor("#111827")
              .text(this.formatEuro(g.total), 40 + 120, startY, {
                width: 70,
              });

            // barra
            const barX = 40 + 120 + 70 + 10;
            const barY = startY + 4;
            const width = Math.max(
              (barMaxWidth * Math.min(pct, 100)) / 100,
              0,
            );

            doc
              .roundedRect(barX, barY, barMaxWidth, 6, 3)
              .fill("#E5E7EB");
            doc
              .roundedRect(barX, barY, width, 6, 3)
              .fill(primaryColor);

            doc
              .font("Helvetica")
              .fontSize(9)
              .fillColor("#6B7280")
              .text(`${pct.toFixed(0)}%`, barX + barMaxWidth + 6, startY + 2);

            doc.moveDown(1.2);
          });

          doc.moveDown(0.8);
          this.drawDivider(doc);
          doc.moveDown(0.5);

          // Detalle por categoría
          nonEmptyGroups.forEach((g) => {
            this.ensureSpace(doc, 60);

            doc
              .font("Helvetica-Bold")
              .fontSize(13)
              .fillColor("#111827")
              .text(`${g.emoji} ${g.label}`);
            doc.moveDown(0.2);

            doc
              .font("Helvetica")
              .fontSize(10)
              .fillColor("#6B7280")
              .text(
                `${g.items.length} gasto${
                  g.items.length > 1 ? "s" : ""
                } · ${this.formatEuro(g.total)}`,
              );

            doc.moveDown(0.4);

            (g.items as any[]).forEach((item) => {
              this.ensureSpace(doc, 40);

              const dateLabel = item.date
                ? this.formatDateShort(item.date)
                : "";
              const timeLabel = item.startTime
                ? new Date(item.startTime).toLocaleTimeString("es-ES", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "";

              doc
                .font("Helvetica-Bold")
                .fontSize(11)
                .fillColor("#111827")
                .text(item.title || "(Sin título)", {
                  indent: 6,
                  width: doc.page.width - 80,
                });

              if (dateLabel || timeLabel) {
                doc
                  .font("Helvetica")
                  .fontSize(10)
                  .fillColor("#6B7280")
                  .text(
                    `   ${dateLabel}${
                      timeLabel ? " · " + timeLabel : ""
                    }`,
                    { indent: 6 },
                  );
              }

              if (item.location) {
                doc
                  .font("Helvetica")
                  .fontSize(10)
                  .fillColor("#6B7280")
                  .text(`   ${item.location}`, {
                    indent: 6,
                    width: doc.page.width - 80,
                  });
              }

              doc
                .font("Helvetica")
                .fontSize(10)
                .fillColor("#111827")
                .text(`   Coste: ${this.formatEuro(item.cost || 0)}`, {
                  indent: 6,
                });

              doc.moveDown(0.5);
            });

            doc.moveDown(0.8);
            this.drawDivider(doc);
          });
        }

        // =====================================================
        // MOVIMIENTOS FINANCIEROS (transactions) OPCIONALES
        // =====================================================

        if (
          includeExpenses &&
          Array.isArray(trip.transactions) &&
          trip.transactions.length
        ) {
          doc.addPage();

          doc
            .font("Helvetica-Bold")
            .fontSize(18)
            .fillColor("#111827")
            .text("Movimientos financieros vinculados");

          this.drawDivider(doc);

          const transactions = trip.transactions as any[];
          const totalTx = transactions.reduce(
            (sum, tx) => sum + (tx.amount || 0),
            0,
          );

          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .fillColor("#111827")
            .text(`Total de movimientos: ${this.formatEuro(totalTx)}`);
          doc.moveDown(0.4);

          const byCategory: Record<string, number> = {};
          for (const tx of transactions) {
            const key = tx.category
              ? tx.category.emoji
                ? `${tx.category.emoji} ${tx.category.name}`
                : tx.category.name
              : "Sin categoría";
            byCategory[key] = (byCategory[key] || 0) + (tx.amount || 0);
          }

          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .text("Por categoría:");
          doc.moveDown(0.3);

          Object.entries(byCategory).forEach(([cat, amount]) => {
            this.ensureSpace(doc, 16);
            doc
              .font("Helvetica")
              .fontSize(11)
              .fillColor("#374151")
              .text(`• ${cat}: ${this.formatEuro(amount)}`);
          });

          doc.moveDown(0.8);
          this.drawDivider(doc);
          doc.moveDown(0.4);

          doc
            .font("Helvetica-Bold")
            .fontSize(12)
            .text("Detalle de movimientos:");
          doc.moveDown(0.3);

          transactions.forEach((tx) => {
            this.ensureSpace(doc, 40);

            const dateStr = this.formatDateShort(tx.date);
            const amountStr = this.formatEuro(tx.amount || 0);
            const catLabel = tx.category
              ? tx.category.emoji
                ? `${tx.category.emoji} ${tx.category.name}`
                : tx.category.name
              : "Sin categoría";

            doc
              .font("Helvetica-Bold")
              .fontSize(11)
              .fillColor("#111827")
              .text(`${amountStr} · ${catLabel}`);

            doc
              .font("Helvetica")
              .fontSize(10)
              .fillColor("#4B5563")
              .text(`${dateStr} · ${tx.description || "Sin descripción"}`, {
                indent: 4,
              });

            if (tx.wallet) {
              doc
                .font("Helvetica")
                .fontSize(9)
                .fillColor("#9CA3AF")
                .text(`Wallet: ${tx.wallet.emoji || ""} ${tx.wallet.name}`, {
                  indent: 4,
                });
            }

            doc.moveDown(0.6);
          });
        }

        // Cierre
        doc.end();
      } catch (e) {
        console.error("❌ Error en generateTripPdfMinimal:", e);
        reject(e);
      }
    });
  }

  // =========================================================
  // HELPERS PDF
  // =========================================================

  private formatDate(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "—";
    const year = d.getFullYear();
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    const day = d.getDate().toString().padStart(2, "0");
    return `${day}/${month}/${year}`;
  }

  private formatDateShort(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "—";
    const day = d.getDate().toString().padStart(2, "0");
    const month = (d.getMonth() + 1).toString().padStart(2, "0");
    return `${day}/${month}`;
  }

  private formatEuro(amount: number): string {
    return (amount || 0).toLocaleString("es-ES", {
      style: "currency",
      currency: "EUR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private countDays(start: Date | string, end: Date | string): number {
    const s = start instanceof Date ? start : new Date(start);
    const e = end instanceof Date ? end : new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 0;
    const diffMs = e.getTime() - s.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
  }

  private groupBy<T>(
    arr: T[],
    keyFn: (item: T) => string,
  ): Record<string, T[]> {
    return arr.reduce((acc, item) => {
      const key = keyFn(item);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {} as Record<string, T[]>);
  }

  private drawDivider(doc: PDFKit.PDFDocument) {
    doc.moveDown(0.4);
    doc
      .moveTo(40, doc.y)
      .lineTo(doc.page.width - 40, doc.y)
      .strokeColor("#E5E7EB")
      .lineWidth(1)
      .stroke();
    doc.moveDown(0.8);
  }

  private ensureSpace(doc: PDFKit.PDFDocument, needed: number) {
    const bottomMargin = 40;
    const available = doc.page.height - bottomMargin - doc.y;
    if (available < needed) {
      doc.addPage();
    }
  }
}