// trips/trips.service.ts
import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "src/common/prisma/prisma.service";
import { NotificationsService } from "../notifications/notifications.service";
import { CreateTripDto, StatusDto, UpdateTripDto, CountryStayDto } from "./dto/create-trip.dto";
import { CreateTripPlanItemDto, PaymentStatus } from "./dto/create-trip-plan-item.dto";
import { AttachTransactionsDto } from "./dto/attach-transactions.dto";
import { InviteTripMemberDto } from "./dto/invite-trip-member.dto";
import PDFDocument = require("pdfkit");
import { AerodataboxService } from "./aviationstack.service";

  import { DateTime } from "luxon";
import { CreateTripNoteDto, CreateTripTaskDto, TaskStatus, UpdateTripNoteDto, UpdateTripTaskDto } from "./dto/trip-notes-tasks.dto";
import { TripDocumentType, UpsertTripDocumentDto } from "./dto/trip-document.dto";
import { CreateTripContactDto, UpdateTripContactDto } from "./dto/trip-contact.dto";
import { CreateTripChecklistItemDto, UpdateTripChecklistItemDto, SeedTripChecklistDto } from "./dto/trip-checklist.dto";

function parseProviderLocalToUtcJsDate(localStr?: string | null) {
  // "2026-04-03 16:00+02:00" -> ISO -> Date
  if (!localStr) return null;
  const iso = localStr.replace(" ", "T"); // "2026-04-03T16:00+02:00"
  const dt = DateTime.fromISO(iso, { setZone: true });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}

function dayIsoToUtcStart(day: string, tz: string) {
  // day "YYYY-MM-DD" in tz -> startOfDay -> UTC Date
  const dt = DateTime.fromISO(day, { zone: tz }).startOf("day");
  if (!dt.isValid) return null;
  return dt.toUTC().toJSDate();
}
function normalizeCountryCode(code?: string | null): string | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) throw new Error("Invalid country code");
  return c;
}

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseNullableDate(v?: string | Date | null) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  return d;
}

type ContinentKey =
  | "europe"
  | "africa"
  | "asia"
  | "north_america"
  | "south_america"
  | "oceania"
  | "antarctica"
  | "unknown";

const CONTINENTS_ORDER: ContinentKey[] = [
  "europe",
  "africa",
  "asia",
  "north_america",
  "south_america",
  "oceania",
  "antarctica",
  "unknown",
];

/**
 * ⚠️ Pon aquí tus totales “países por continente”.
 * Si quieres precisión absoluta, usa la opción 2 con tabla Country.
 */
const TOTAL_COUNTRIES_BY_CONTINENT: Record<ContinentKey, number> = {
  europe: 45,
  africa: 54,
  asia: 47,
  north_america: 23,
  south_america: 12,
  oceania: 14,
  antarctica: 0,
  unknown: 0,
};

function safePct(num: number, den: number) {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 100);
}

interface DerivedFromStays {
  destination: string | null;
  continent: string | null;
  startDate?: Date;
  endDate?: Date;
}

// The "primary" country of a multi-country trip is whichever stay starts
// earliest (stays without a date fall back to array order); Trip's overall
// startDate/endDate become the min/max across every stay's own range.
function deriveFromStays(stays: CountryStayDto[]): DerivedFromStays {
  const parsed = stays.map((s) => ({
    country: normalizeCountryCode(s.country),
    continent: s.continent ?? null,
    startDate: s.startDate ? new Date(s.startDate) : null,
    endDate: s.endDate ? new Date(s.endDate) : null,
  }));

  const sorted = [...parsed].sort((a, b) => {
    if (a.startDate && b.startDate) return a.startDate.getTime() - b.startDate.getTime();
    if (a.startDate) return -1;
    if (b.startDate) return 1;
    return 0;
  });
  const primary = sorted[0];

  const starts = parsed.map((s) => s.startDate).filter((d): d is Date => !!d);
  const ends = parsed.map((s) => s.endDate).filter((d): d is Date => !!d);

  return {
    destination: primary?.country ?? null,
    continent: primary?.continent ?? null,
    startDate: starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : undefined,
    endDate: ends.length ? new Date(Math.max(...ends.map((d) => d.getTime()))) : undefined,
  };
}


@Injectable()
export class TripsService {
  constructor(
    private prisma: PrismaService,
    private aerodatabox: AerodataboxService,
    private notifications: NotificationsService,
  ) {}

  // A trip is accessible to its creator and to any accepted TripMember.
  private tripAccessFilter(userId: number) {
    return { OR: [{ userId }, { members: { some: { userId, status: "accepted" as const } } }] };
  }

  private wrapChecklistError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      throw new ServiceUnavailableException("Checklist temporalmente no disponible. Falta aplicar la migración en base de datos.");
    }
    throw error;
  }

  // Keeps TripCountryStay in sync with a create/update payload:
  // - countryStays provided (non-empty) -> full replace, one row per stay.
  // - only destination provided (legacy single-country flow) -> replace
  //   with exactly one stay mirroring the scalar fields, so every trip with
  //   a destination always has a matching stay for getSummary/getContinentsStats/
  //   the World module to read.
  // - neither provided -> leave existing stays untouched (e.g. editing just
  //   budget/status shouldn't wipe country data).
  private async syncCountryStays(
    tripId: number,
    dto: CreateTripDto | UpdateTripDto,
    fallbackDates: { startDate?: Date; endDate?: Date }
  ) {
    if (dto.countryStays && dto.countryStays.length > 0) {
      await this.prisma.tripCountryStay.deleteMany({ where: { tripId } });
      await this.prisma.tripCountryStay.createMany({
        data: dto.countryStays.map((s, index) => ({
          tripId,
          country: normalizeCountryCode(s.country)!,
          continent: s.continent as any,
          startDate: s.startDate ? new Date(s.startDate) : null,
          endDate: s.endDate ? new Date(s.endDate) : null,
          order: index,
        })),
      });
    } else if (dto.destination !== undefined) {
      await this.prisma.tripCountryStay.deleteMany({ where: { tripId } });
      const code = normalizeCountryCode(dto.destination);
      if (code) {
        await this.prisma.tripCountryStay.create({
          data: {
            tripId,
            country: code,
            continent: dto.continent as any,
            startDate: fallbackDates.startDate ?? null,
            endDate: fallbackDates.endDate ?? null,
            order: 0,
          },
        });
      }
    }
  }

  // ✅ util para controller — dueño original o compañero aceptado, mismo acceso
  async assertTripOwnership(userId: number, tripId: number) {
    const trip = await this.prisma.trip.findFirst({
      where: { id: tripId, ...this.tripAccessFilter(userId) },
      select: { id: true },
    });
    if (!trip) throw new ForbiddenException();
    return true;
  }

  private countryFlag(iso2?: string | null): string {
    if (!iso2 || iso2.length !== 2) return '✈️';
    return [...iso2.toUpperCase()].map((c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1a5)).join('');
  }

  private async buildUniqueTripSubcategoryName(
    categoryId: number,
    baseName: string,
    excludeSubcategoryId?: number,
  ): Promise<string> {
    const trimmed = baseName.trim() || 'Viaje';
    let candidate = trimmed;
    let suffix = 2;

    while (true) {
      const existing = await this.prisma.subcategory.findFirst({
        where: {
          categoryId,
          name: candidate,
          active: true,
          ...(excludeSubcategoryId ? { id: { not: excludeSubcategoryId } } : {}),
        },
        select: { id: true },
      });

      if (!existing) return candidate;

      candidate = `${trimmed} ${suffix}`;
      suffix += 1;
    }
  }

  private async syncTripSubcategory(userId: number, tripId: number, tripName: string, destination?: string | null): Promise<void> {
    const viajesCategory = await this.prisma.category.findFirst({
      where: { userId, type: 'expense', name: { contains: 'viaje', mode: 'insensitive' }, active: true },
    });
    if (!viajesCategory) return;

    const existingByTrip = await this.prisma.subcategory.findFirst({
      where: { tripId },
    });

    if (existingByTrip) {
      const uniqueName = await this.buildUniqueTripSubcategoryName(
        viajesCategory.id,
        tripName,
        existingByTrip.id,
      );
      await this.prisma.subcategory.update({
        where: { id: existingByTrip.id },
        data: {
          categoryId: viajesCategory.id,
          name: uniqueName,
          emoji: this.countryFlag(destination),
          active: true,
        },
      });
      return;
    }

    const legacyByName = await this.prisma.subcategory.findFirst({
      where: {
        categoryId: viajesCategory.id,
        tripId: null,
        name: tripName,
        active: true,
      },
    });

    if (legacyByName) {
      await this.prisma.subcategory.update({
        where: { id: legacyByName.id },
        data: {
          tripId,
          name: tripName,
          emoji: this.countryFlag(destination),
          active: true,
        },
      });
      return;
    }

    const last = await this.prisma.subcategory.findFirst({
      where: { categoryId: viajesCategory.id },
      orderBy: { position: 'desc' },
      select: { position: true },
    });

    const uniqueName = await this.buildUniqueTripSubcategoryName(viajesCategory.id, tripName);

    await this.prisma.subcategory.create({
      data: {
        name: uniqueName,
        categoryId: viajesCategory.id,
        tripId,
        emoji: this.countryFlag(destination),
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  private async removeTripSubcategory(userId: number, tripId: number, tripName: string): Promise<void> {
    const result = await this.prisma.subcategory.updateMany({
      where: { tripId, active: true },
      data: { active: false },
    });

    if (result.count > 0) return;

    const viajesCategory = await this.prisma.category.findFirst({
      where: { userId, type: 'expense', name: { contains: 'viaje', mode: 'insensitive' }, active: true },
      select: { id: true },
    });
    if (!viajesCategory) return;

    await this.prisma.subcategory.updateMany({
      where: {
        categoryId: viajesCategory.id,
        tripId: null,
        name: tripName,
        active: true,
      },
      data: { active: false },
    });
  }

  async createTrip(userId: number, dto: CreateTripDto) {
    const derived = dto.countryStays?.length ? deriveFromStays(dto.countryStays) : null;

    const startDate = derived?.startDate ?? (dto.startDate ? new Date(dto.startDate) : undefined);
    const endDate = derived?.endDate ?? (dto.endDate ? new Date(dto.endDate) : undefined);
    const destination = derived ? derived.destination : normalizeCountryCode(dto.destination);
    const continent = derived ? (derived.continent as any) : dto.continent;

    const year = startDate?.getFullYear() ?? endDate?.getFullYear() ?? undefined;

    const trip = await this.prisma.trip.create({
      data: {
        userId,
        name: dto.name,
        destination,
        startDate,
        endDate,
        companions: dto.companions ?? [],
        budget: dto.budget,
        cost: dto.cost,
        continent,
        year,
        status: dto.status,
        coverImageUrl: dto.coverImageUrl ?? null,
      },
    });

    await this.syncCountryStays(trip.id, dto, { startDate, endDate });

    if (dto.status === StatusDto.planning) {
      await this.syncTripSubcategory(userId, trip.id, dto.name, destination).catch(() => {});
    }

    return this.prisma.trip.findUnique({
      where: { id: trip.id },
      include: { countryStays: { orderBy: { order: "asc" } } },
    });
  }

  async getTrips(userId: number, country?: string) {
    // si no hay fechas, ordena por createdAt para wishlist
    return this.prisma.trip.findMany({
      where: {
        ...this.tripAccessFilter(userId),
        ...(country ? { countryStays: { some: { country: country.trim().toUpperCase() } } } : {}),
      },
      include: {
        countryStays: { orderBy: { order: "asc" } },
        user: { select: { id: true, name: true, email: true } },
        members: { where: { status: "accepted" }, include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
  }

async getTripDetail(userId: number, tripId: number) {
  const trip = await this.prisma.trip.findFirst({
    where: { id: tripId, ...this.tripAccessFilter(userId) },
    include: {
      user: { select: { id: true, name: true, email: true } },
      members: { where: { status: "accepted" }, include: { user: { select: { id: true, name: true, email: true } } } },

      notes: { orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] },
      tasks: { orderBy: [{ status: "asc" }, { updatedAt: "desc" }] },

      planItems: {
        orderBy: [{ day: "asc" }, { startAt: "asc" }, { createdAt: "asc" }],
        include: {
          flightDetails: true,
          accommodationDetails: true,
          destinationTransport: true,
          attachments: true,
        },
      },

      transactions: {
        where: { active: true },
        include: { category: true, subcategory: true, wallet: true },
      },

      countryStays: { orderBy: { order: "asc" } },
    },
  });

  if (!trip) throw new NotFoundException("Trip not found");
  return trip;
}

  async updateTrip(userId: number, tripId: number, dto: UpdateTripDto) {
    const existing = await this.prisma.trip.findFirst({ where: { id: tripId, ...this.tripAccessFilter(userId) } });
    if (!existing) throw new ForbiddenException();

    const { countryStays, ...rest } = dto;
    const derived = countryStays?.length ? deriveFromStays(countryStays) : null;

    const startDate = derived?.startDate ?? (dto.startDate ? new Date(dto.startDate) : undefined);
    const endDate = derived?.endDate ?? (dto.endDate ? new Date(dto.endDate) : undefined);
    const year = startDate?.getFullYear() ?? endDate?.getFullYear() ?? undefined;

    const updated = await this.prisma.trip.update({
      where: { id: tripId },
      data: {
        ...rest,
        destination: derived ? derived.destination : dto.destination ? normalizeCountryCode(dto.destination) : undefined,
        continent: derived ? (derived.continent as any) : dto.continent,
        startDate,
        endDate,
        year,
      },
    });

    await this.syncCountryStays(tripId, dto, {
      startDate: startDate ?? existing.startDate ?? undefined,
      endDate: endDate ?? existing.endDate ?? undefined,
    });

    if (updated.status === StatusDto.planning) {
      await this.syncTripSubcategory(userId, updated.id, updated.name, updated.destination).catch(() => {});
    }

    return this.prisma.trip.findUnique({
      where: { id: tripId },
      include: { countryStays: { orderBy: { order: "asc" } } },
    });
  }

  async deleteTrip(userId: number, tripId: number) {
    const existing = await this.prisma.trip.findFirst({ where: { id: tripId, ...this.tripAccessFilter(userId) } });
    if (!existing) throw new ForbiddenException();

    await this.prisma.transaction.updateMany({
      where: { tripId },
      data: { tripId: null },
    });

    await this.removeTripSubcategory(userId, tripId, existing.name).catch(() => {});

    return this.prisma.trip.delete({ where: { id: tripId } });
  }

  // =========================================================
  // COMPAÑEROS DE VIAJE
  // =========================================================

  async listTripMembers(userId: number, tripId: number) {
    await this.assertTripOwnership(userId, tripId);
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      select: { userId: true, user: { select: { id: true, name: true, email: true } } },
    });
    if (!trip) throw new NotFoundException("Trip not found");

    const members = await this.prisma.tripMember.findMany({
      where: { tripId, status: "accepted" },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });

    return { owner: trip.user, members: members.map((m) => m.user) };
  }

  async listTripInviteCandidates(userId: number, tripId: number) {
    await this.assertTripOwnership(userId, tripId);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, select: { userId: true } });
    if (!trip) throw new NotFoundException("Trip not found");

    const friendships = await this.prisma.friendship.findMany({
      where: { status: "accepted", OR: [{ requesterId: userId }, { addresseeId: userId }] },
      include: {
        requester: { select: { id: true, name: true, email: true } },
        addressee: { select: { id: true, name: true, email: true } },
      },
    });
    const friends = friendships.map((f) => (f.requesterId === userId ? f.addressee : f.requester));

    const members = await this.prisma.tripMember.findMany({
      where: { tripId },
      select: { userId: true, status: true },
    });
    const statusByUserId = new Map(members.map((m) => [m.userId, m.status]));

    return friends
      .filter((f) => f.id !== trip.userId)
      .map((f) => ({ ...f, inviteStatus: statusByUserId.get(f.id) ?? null }));
  }

  async inviteTripMember(userId: number, tripId: number, dto: InviteTripMemberDto) {
    await this.assertTripOwnership(userId, tripId);

    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, select: { id: true, name: true, userId: true } });
    if (!trip) throw new NotFoundException("Trip not found");

    if (dto.userId === userId) throw new BadRequestException("No puedes invitarte a ti mismo");
    if (dto.userId === trip.userId) throw new ConflictException("Ya es el organizador de este viaje");

    const isFriend = await this.prisma.friendship.findFirst({
      where: {
        status: "accepted",
        OR: [
          { requesterId: userId, addresseeId: dto.userId },
          { requesterId: dto.userId, addresseeId: userId },
        ],
      },
    });
    if (!isFriend) throw new BadRequestException("Solo puedes invitar a amigos");

    const existing = await this.prisma.tripMember.findUnique({
      where: { tripId_userId: { tripId, userId: dto.userId } },
    });
    if (existing?.status === "accepted") throw new ConflictException("Ya es compañero de este viaje");
    if (existing?.status === "pending") throw new ConflictException("Ya tiene una invitación pendiente");

    const member = await this.prisma.tripMember.create({
      data: { tripId, userId: dto.userId, status: "pending", invitedBy: userId },
    });

    const inviter = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await this.notifications.notifyUser(
      dto.userId,
      "Invitación a un viaje",
      `${inviter?.name ?? "Alguien"} te invitó a "${trip.name}"`,
      "trip_invite",
      { tripMemberId: member.id },
    );

    return member;
  }

  async getTripInviteDetail(userId: number, memberId: number) {
    const member = await this.prisma.tripMember.findFirst({
      where: { id: memberId, userId, status: "pending" },
      include: { trip: { include: { countryStays: { orderBy: { order: "asc" } } } } },
    });
    if (!member) throw new NotFoundException("Invitación no encontrada");

    const inviter = await this.prisma.user.findUnique({ where: { id: member.invitedBy }, select: { id: true, name: true } });

    return {
      id: member.id,
      trip: {
        id: member.trip.id,
        name: member.trip.name,
        destination: member.trip.destination,
        coverImageUrl: member.trip.coverImageUrl,
        startDate: member.trip.startDate,
        endDate: member.trip.endDate,
        countryStays: member.trip.countryStays,
      },
      inviter,
    };
  }

  async respondTripInvite(userId: number, memberId: number, accept: boolean) {
    const member = await this.prisma.tripMember.findFirst({
      where: { id: memberId, userId, status: "pending" },
      include: { trip: { select: { id: true, name: true, userId: true } } },
    });
    if (!member) throw new NotFoundException("Invitación no encontrada");

    if (!accept) {
      await this.prisma.tripMember.delete({ where: { id: memberId } });
      return { ok: true, status: "rejected" };
    }

    const updated = await this.prisma.tripMember.update({
      where: { id: memberId },
      data: { status: "accepted" },
    });

    const accepter = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    await this.notifications.notifyUser(
      member.trip.userId,
      "Invitación aceptada",
      `${accepter?.name ?? "Alguien"} se ha unido a "${member.trip.name}"`,
      "trip_invite_accepted",
      { tripId: member.trip.id },
    );

    return updated;
  }

  async removeTripMember(userId: number, tripId: number, memberUserId: number) {
    await this.assertTripOwnership(userId, tripId);
    const trip = await this.prisma.trip.findUnique({ where: { id: tripId }, select: { userId: true } });
    if (!trip) throw new NotFoundException("Trip not found");
    if (trip.userId === memberUserId) throw new BadRequestException("No puedes eliminar al organizador del viaje");

    await this.prisma.tripMember.deleteMany({ where: { tripId, userId: memberUserId } });
    return { ok: true };
  }

  private async recomputeTripPlannedCost(tripId: number) {
    const items = await this.prisma.tripPlanItem.findMany({
      where: { tripId },
      select: { cost: true },
    });

    // cost puede ser Float o Decimal según tu schema real
    const total = items.reduce((sum, item) => {
      const v: any = item.cost;
      if (v == null) return sum;
      const n = typeof v === "number" ? v : Number(v);
      return sum + (isNaN(n) ? 0 : n);
    }, 0);

    await this.prisma.trip.update({
      where: { id: tripId },
      data: { cost: total },
    });
  }

  // =========================================================
  // CREATE PLAN ITEM (NEW)
  // =========================================================
async addPlanItem(userId: number, tripId: number, dto: CreateTripPlanItemDto) {
  await this.assertTripOwnership(userId, tripId);

  const startAt = parseNullableDate((dto as any).startAt ?? (dto as any).startTime ?? null);
  const endAt = parseNullableDate((dto as any).endAt ?? (dto as any).endTime ?? null);
  const day =
    parseNullableDate((dto as any).day ?? (dto as any).date ?? null) ??
    (startAt ? startOfDay(startAt) : null);

  const timezone = (dto as any).timezone ?? null;
  const currency = (dto as any).currency ?? null;
  const logistics = typeof (dto as any).logistics === "boolean" ? (dto as any).logistics : false;
  const metadata = (dto as any).metadata ?? null;

  // ✅ Location normalizada por tipo
  const rawLocation = dto.location ?? null;

  const accommodationAddress =
    dto.type === "accommodation"
      ? String((dto as any).accommodationDetails?.address ?? "").trim()
      : "";

  const location =
    dto.type === "accommodation" && accommodationAddress
      ? accommodationAddress
      : rawLocation;

  // Validaciones mínimas por tipo
  if (!dto.type) throw new BadRequestException("type requerido");
  if (!dto.title?.trim()) throw new BadRequestException("title requerido");

  const created = await this.prisma.$transaction(async (tx) => {
    const planItem = await tx.tripPlanItem.create({
      data: {
        tripId,
        type: dto.type as any,
        title: dto.title,

        // legacy (no borrar)
        date: (dto as any).date ? new Date((dto as any).date) : null,
        startTime: (dto as any).startTime ? new Date((dto as any).startTime) : null,
        endTime: (dto as any).endTime ? new Date((dto as any).endTime) : null,

        // new
        day,
        startAt,
        endAt,
        timezone,

        // ✅ aquí ya va forzado
        location,
        notes: dto.notes ?? null,
        transactionId: (dto as any).transactionId ?? null,

        cost: (dto as any).cost ?? null,
        currency,
        logistics,
        metadata,
      },
    });

    // ===== details por tipo =====
    if (dto.type === "flight") {
      const fd = (dto as any).flightDetails;
      if (fd) {
        await tx.flightDetails.create({
          data: {
            planItemId: planItem.id,
            provider: fd.provider ?? "manual",
            status: fd.status ?? null,
            lastUpdatedUtc: fd.lastUpdatedUtc ? new Date(fd.lastUpdatedUtc) : null,

            flightNumberRaw: fd.flightNumberRaw ?? null,
            flightNumberIata: fd.flightNumberIata ?? null,
            airlineName: fd.airlineName ?? null,
            airlineIata: fd.airlineIata ?? null,

            fromIata: fd.fromIata ?? null,
            toIata: fd.toIata ?? null,
            fromName: fd.fromName ?? null,
            toName: fd.toName ?? null,
            fromCity: fd.fromCity ?? null,
            toCity: fd.toCity ?? null,
            depTz: fd.depTz ?? null,
            arrTz: fd.arrTz ?? null,

            depTerminal: fd.depTerminal ?? null,
            arrTerminal: fd.arrTerminal ?? null,

            gate: fd.gate ?? null,
            seat: fd.seat ?? null,
            bookingRef: fd.bookingRef ?? null,

            aircraftModel: fd.aircraftModel ?? null,

            schedDepAt: fd.schedDepAt ? new Date(fd.schedDepAt) : null,
            schedArrAt: fd.schedArrAt ? new Date(fd.schedArrAt) : null,
            estDepAt: fd.estDepAt ? new Date(fd.estDepAt) : null,
            estArrAt: fd.estArrAt ? new Date(fd.estArrAt) : null,
            actDepAt: fd.actDepAt ? new Date(fd.actDepAt) : null,
            actArrAt: fd.actArrAt ? new Date(fd.actArrAt) : null,

            providerRaw: fd.providerRaw ?? null,
          },
        });
      }
    }

    if (dto.type === "accommodation") {
      const ad = (dto as any).accommodationDetails;
      if (ad) {
        await tx.accommodationDetails.create({
          data: {
            planItemId: planItem.id,
            name: ad.name ?? null,
            address: ad.address ?? null,
            city: ad.city ?? null,
            country: ad.country ?? null,
            checkInAt: ad.checkInAt ? new Date(ad.checkInAt) : null,
            checkOutAt: ad.checkOutAt ? new Date(ad.checkOutAt) : null,
            guests: ad.guests ?? null,
            rooms: ad.rooms ?? null,
            bookingRef: ad.bookingRef ?? null,
            phone: ad.phone ?? null,
            website: ad.website ?? null,
            coverImageUrl: ad.coverImageUrl ?? null,
            metadata: ad.metadata ?? null,
          },
        });
      }
    }

    if (dto.type === "transport_destination" || dto.type === "transport_local") {
      const td = (dto as any).destinationTransportDetails;
      if (!td?.mode) throw new BadRequestException("destinationTransportDetails.mode requerido");

      await tx.destinationTransportDetails.create({
        data: {
          planItemId: planItem.id,
          mode: td.mode,
          company: td.company ?? null,
          bookingRef: td.bookingRef ?? null,
          fromName: td.fromName ?? null,
          toName: td.toName ?? null,
          depAt: td.depAt ? new Date(td.depAt) : null,
          arrAt: td.arrAt ? new Date(td.arrAt) : null,
          metadata: td.metadata ?? null,
        },
      });
    }

    const attachments = Array.isArray((dto as any).attachments) ? (dto as any).attachments : [];
    if (attachments.length > 0) {
      await tx.attachment.createMany({
        data: attachments.map((file: any) => ({
          planItemId: planItem.id,
          kind: file.kind,
          url: file.url,
          filename: file.filename ?? null,
          mimeType: file.mimeType ?? null,
          sizeBytes: file.sizeBytes ?? null,
          metadata: file.metadata ?? null,
        })),
      });
    }

    return planItem;
  });

  await this.recomputeTripPlannedCost(tripId);

  return this.prisma.tripPlanItem.findUnique({
    where: { id: created.id },
    include: { flightDetails: true, accommodationDetails: true, destinationTransport: true, attachments: true },
  });
}

  async updatePlanItem(userId: number, tripId: number, planItemId: number, dto: CreateTripPlanItemDto) {
    // ownership + existence
    const existing = await this.prisma.tripPlanItem.findFirst({
      where: { id: planItemId, tripId, trip: this.tripAccessFilter(userId) },
      include: { flightDetails: true, accommodationDetails: true, destinationTransport: true },
    });
    if (!existing) throw new ForbiddenException();

    const startAt = parseNullableDate((dto as any).startAt ?? (dto as any).startTime ?? null);
    const endAt = parseNullableDate((dto as any).endAt ?? (dto as any).endTime ?? null);
    const day = parseNullableDate((dto as any).day ?? (dto as any).date ?? null) ?? (startAt ? startOfDay(startAt) : null);

    const timezone = (dto as any).timezone ?? null;
    const currency = (dto as any).currency ?? null;
    const logistics = typeof (dto as any).logistics === "boolean" ? (dto as any).logistics : existing.logistics;
    const metadata = (dto as any).metadata ?? existing.metadata;

    const updated = await this.prisma.$transaction(async (tx) => {
      const base = await tx.tripPlanItem.update({
        where: { id: planItemId },
        data: {
          type: dto.type as any,
          title: dto.title,
          // legacy
          date: (dto as any).date ? new Date((dto as any).date) : null,
          startTime: (dto as any).startTime ? new Date((dto as any).startTime) : null,
          endTime: (dto as any).endTime ? new Date((dto as any).endTime) : null,

          // new
          day,
          startAt,
          endAt,
          timezone,

          location: dto.location ?? null,
          notes: dto.notes ?? null,
          transactionId: (dto as any).transactionId ?? null,

          cost: (dto as any).cost ?? null,
          currency,
          logistics,
          metadata,
        },
      });

      // strategy: upsert details del tipo activo, y opcionalmente borrar details de otros tipos
      if (dto.type === "flight") {
        const fd = (dto as any).flightDetails ?? null;
        if (fd) {
          await tx.flightDetails.upsert({
            where: { planItemId: planItemId },
            create: { planItemId, provider: fd.provider ?? "manual", providerRaw: fd.providerRaw ?? null },
            update: { provider: fd.provider ?? "manual", providerRaw: fd.providerRaw ?? null },
          });

          await tx.flightDetails.update({
            where: { planItemId },
            data: {
              status: fd.status ?? null,
              lastUpdatedUtc: fd.lastUpdatedUtc ? new Date(fd.lastUpdatedUtc) : null,
              flightNumberRaw: fd.flightNumberRaw ?? null,
              flightNumberIata: fd.flightNumberIata ?? null,
              airlineName: fd.airlineName ?? null,
              airlineIata: fd.airlineIata ?? null,
              fromIata: fd.fromIata ?? null,
              toIata: fd.toIata ?? null,
              fromName: fd.fromName ?? null,
              toName: fd.toName ?? null,
              fromCity: fd.fromCity ?? null,
              toCity: fd.toCity ?? null,
              depTz: fd.depTz ?? null,
              arrTz: fd.arrTz ?? null,
              depTerminal: fd.depTerminal ?? null,
              arrTerminal: fd.arrTerminal ?? null,
              gate: fd.gate ?? null,
              seat: fd.seat ?? null,
              bookingRef: fd.bookingRef ?? null,
              aircraftModel: fd.aircraftModel ?? null,
              schedDepAt: fd.schedDepAt ? new Date(fd.schedDepAt) : null,
              schedArrAt: fd.schedArrAt ? new Date(fd.schedArrAt) : null,
              estDepAt: fd.estDepAt ? new Date(fd.estDepAt) : null,
              estArrAt: fd.estArrAt ? new Date(fd.estArrAt) : null,
              actDepAt: fd.actDepAt ? new Date(fd.actDepAt) : null,
              actArrAt: fd.actArrAt ? new Date(fd.actArrAt) : null,
            },
          });
        }
      } else {
        // si cambia de tipo, limpia details anteriores
        await tx.flightDetails.deleteMany({ where: { planItemId } });
      }

      if (dto.type === "accommodation") {
        const ad = (dto as any).accommodationDetails ?? null;
        if (ad) {
          await tx.accommodationDetails.upsert({
            where: { planItemId },
            create: { planItemId },
            update: {},
          });
          await tx.accommodationDetails.update({
            where: { planItemId },
            data: {
              name: ad.name ?? null,
              address: ad.address ?? null,
              city: ad.city ?? null,
              country: ad.country ?? null,
              checkInAt: ad.checkInAt ? new Date(ad.checkInAt) : null,
              checkOutAt: ad.checkOutAt ? new Date(ad.checkOutAt) : null,
              guests: ad.guests ?? null,
              rooms: ad.rooms ?? null,
              bookingRef: ad.bookingRef ?? null,
              phone: ad.phone ?? null,
              website: ad.website ?? null,
              coverImageUrl: ad.coverImageUrl ?? null,
              metadata: ad.metadata ?? null,
            },
          });
        }
      } else {
        await tx.accommodationDetails.deleteMany({ where: { planItemId } });
      }

      if (dto.type === "transport_destination" || dto.type === "transport_local") {
        const td = (dto as any).destinationTransportDetails;
        if (!td?.mode) throw new BadRequestException("destinationTransportDetails.mode requerido");

        await tx.destinationTransportDetails.upsert({
          where: { planItemId },
          create: { planItemId, mode: td.mode },
          update: { mode: td.mode },
        });

        await tx.destinationTransportDetails.update({
          where: { planItemId },
          data: {
            company: td.company ?? null,
            bookingRef: td.bookingRef ?? null,
            fromName: td.fromName ?? null,
            toName: td.toName ?? null,
            depAt: td.depAt ? new Date(td.depAt) : null,
            arrAt: td.arrAt ? new Date(td.arrAt) : null,
            metadata: td.metadata ?? null,
          },
        });
      } else {
        await tx.destinationTransportDetails.deleteMany({ where: { planItemId } });
      }

      if ((dto as any).attachments !== undefined) {
        const attachments = Array.isArray((dto as any).attachments) ? (dto as any).attachments : [];
        await tx.attachment.deleteMany({ where: { planItemId } });
        if (attachments.length > 0) {
          await tx.attachment.createMany({
            data: attachments.map((file: any) => ({
              planItemId,
              kind: file.kind,
              url: file.url,
              filename: file.filename ?? null,
              mimeType: file.mimeType ?? null,
              sizeBytes: file.sizeBytes ?? null,
              metadata: file.metadata ?? null,
            })),
          });
        }
      }

      return base;
    });

    await this.recomputeTripPlannedCost(tripId);

    return this.prisma.tripPlanItem.findUnique({
      where: { id: updated.id },
      include: { flightDetails: true, accommodationDetails: true, destinationTransport: true, attachments: true },
    });
  }

  async deletePlanItem(userId: number, tripId: number, planItemId: number) {
    const existing = await this.prisma.tripPlanItem.findFirst({
      where: { id: planItemId, tripId, trip: this.tripAccessFilter(userId) },
    });
    if (!existing) throw new ForbiddenException();

    await this.prisma.tripPlanItem.delete({ where: { id: planItemId } });
    await this.recomputeTripPlannedCost(tripId);

    return { success: true };
  }

  async attachTransactions(userId: number, tripId: number, dto: AttachTransactionsDto) {
    await this.assertTripOwnership(userId, tripId);

    await this.prisma.transaction.updateMany({
      where: { id: { in: dto.transactionIds }, userId },
      data: { tripId },
    });

    return { success: true };
  }

  async detachTransactions(userId: number, tripId: number, dto: AttachTransactionsDto) {
    await this.assertTripOwnership(userId, tripId);

    await this.prisma.transaction.updateMany({
      where: { id: { in: dto.transactionIds }, userId, tripId },
      data: { tripId: null },
    });

    return { success: true };
  }

  // =========================================================
  // SUMMARY (igual que el tuyo)
  // =========================================================
  async getSummary(userId: number) {
    const TOTAL_COUNTRIES = 195;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextTrip = await this.prisma.trip.findFirst({
      where: {
        userId,
        status: "planning" as StatusDto,
        startDate: { gte: today },
        destination: { not: null },
      },
      orderBy: { startDate: "asc" },
      select: { id: true, name: true, startDate: true, destination: true },
    });

    const daysToNextTrip = nextTrip?.startDate
      ? Math.max(0, Math.ceil((nextTrip.startDate.getTime() - today.getTime()) / 86400000))
      : null;

    const seenStays = await this.prisma.tripCountryStay.findMany({
      where: { trip: { userId, status: "seen" as any } },
      select: { country: true },
    });

    const visitedSet = new Set(
      seenStays
        .map((s) => (s.country || "").trim().toUpperCase())
        .filter(Boolean)
    );

    const visitedCountries = visitedSet.size;
    const pendingCountries = Math.max(0, TOTAL_COUNTRIES - visitedCountries);

    const visitedPct = Math.round((visitedCountries / TOTAL_COUNTRIES) * 100);

    return {
      daysToNextTrip,
      nextTrip: nextTrip ? { id: nextTrip.id, name: nextTrip.name, startDate: nextTrip.startDate } : null,
      visitedCountries,
      pendingCountries,
      visitedPct,
      totalCountries: TOTAL_COUNTRIES,
    };
  }

  // =========================================================
  // PDF EXPORT: aquí lo crítico es cambiar date/startTime a day/startAt
  // (no te lo reescribo entero para no pegarte 400 líneas)
  // =========================================================
  async exportTripToPdf(tripId: number, includeExpenses: boolean) {
    const trip = await this.prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        user: { select: { id: true, name: true } },
        members: { where: { status: "accepted" }, include: { user: { select: { id: true, name: true } } } },
        countryStays: { orderBy: { order: "asc" } },
        tasks: { orderBy: [{ status: "asc" }, { updatedAt: "desc" }] },
        notes: { orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }] },
        planItems: {
          orderBy: [{ day: "asc" }, { startAt: "asc" }, { createdAt: "asc" }],
          include: { flightDetails: true, accommodationDetails: true, destinationTransport: true },
        },
        transactions: includeExpenses
          ? { where: { active: true }, include: { category: true, subcategory: true, wallet: true } }
          : false,
      },
    });

    if (!trip) throw new NotFoundException("Viaje no encontrado");

    const pdfBuffer = await this.generateTripPdfMinimal(trip, includeExpenses);

    return { base64: pdfBuffer.toString("base64"), fileName: `viaje-${trip.id}.pdf` };
  }

  private readonly PLAN_ITEM_TYPE_LABELS: Record<string, string> = {
    flight: "Vuelo",
    accommodation: "Alojamiento",
    transport_destination: "Traslado",
    transport_local: "Transporte",
    museum: "Museo",
    monument: "Monumento",
    viewpoint: "Mirador",
    free_tour: "Free tour",
    guided_tour: "Tour guiado",
    concert: "Concierto",
    sport: "Deporte",
    bar_party: "Fiesta",
    nightlife: "Vida nocturna",
    beach: "Playa",
    hike: "Ruta",
    restaurant: "Restaurante",
    cafe: "Café",
    market: "Mercado",
    shopping: "Compras",
    day_trip: "Excursión",
    activity: "Actividad",
    expense: "Gasto",
    visit: "Visita",
    other: "Otro",
  };

  // Misma taxonomía y mismo mapeo tipo→categoría que TripExpensesSection.tsx
  // (la pantalla "Gastos" del viaje en la app), para que el PDF coincida con
  // lo que el usuario ve ahí en vez de con las Transaction adjuntas.
  private readonly BUDGET_CATEGORY_DEFS: { key: string; label: string; color: string }[] = [
    { key: "accommodation", label: "Alojamiento", color: "#22C55E" },
    { key: "transport_main", label: "Transporte principal", color: "#2563EB" },
    { key: "transport_local", label: "Transporte local", color: "#0EA5E9" },
    { key: "food", label: "Comida", color: "#F97316" },
    { key: "activities", label: "Actividades / visitas", color: "#A855F7" },
    { key: "leisure", label: "Ocio", color: "#EF4444" },
    { key: "shopping", label: "Compras", color: "#F59E0B" },
    { key: "other", label: "Otros / fees", color: "#475569" },
  ];

  private categoryForPlanItem(item: any): string {
    if (item.type === "expense") {
      return item.metadata?.expenseCategory ?? "other";
    }
    const t = item.type;
    if (t === "accommodation") return "accommodation";
    if (t === "flight" || t === "transport_destination") return "transport_main";
    if (t === "transport_local" || t === "transport" || t === "taxi") return "transport_local";
    if (t === "restaurant" || t === "cafe" || t === "market") return "food";
    if (["museum", "monument", "viewpoint", "free_tour", "guided_tour", "day_trip", "hike", "beach", "activity"].includes(t)) {
      return "activities";
    }
    if (["concert", "sport", "bar_party", "nightlife"].includes(t)) return "leisure";
    if (t === "shopping") return "shopping";
    return "other";
  }

  private async generateTripPdfMinimal(trip: any, includeExpenses: boolean): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 0 });
      const chunks: Buffer[] = [];
      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const PRIMARY = "#2563EB";
      const PRIMARY_DARK = "#1D4ED8";
      const TEXT = "#0F172A";
      const MUTED = "#64748B";
      const MUTED_LIGHT = "#94A3B8";
      const BORDER = "#E2E8F0";
      const CARD_BG = "#F8FAFC";
      const MARGIN_X = 50;
      const CONTENT_WIDTH = 495; // 595 (A4 pt width) - 2*50
      const PAGE_BOTTOM = 780;

      const capitalize = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
      const fmtEuro = (n: unknown) => {
        const v = typeof n === "number" ? n : Number(n);
        return isNaN(v) ? null : `${v.toFixed(2).replace(".", ",")} €`;
      };
      const fmtTime = (iso: unknown) => {
        if (!iso) return null;
        const d = new Date(iso as string);
        if (isNaN(d.getTime())) return null;
        return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      };
      const fmtDateLong = (d: Date) =>
        capitalize(d.toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" }));
      const ensureSpace = (needed: number) => {
        if (doc.y + needed > PAGE_BOTTOM) {
          doc.addPage();
          doc.x = MARGIN_X;
          doc.y = 50;
        }
      };
      const sectionHeader = (title: string) => {
        ensureSpace(50);
        doc.moveDown(0.9);
        doc.rect(MARGIN_X, doc.y + 2, 4, 16).fill(PRIMARY);
        doc.fontSize(15).font("Helvetica-Bold").fillColor(TEXT).text(title, MARGIN_X + 12, doc.y);
        doc.moveDown(0.5);
      };

      // ── Portada (banda de color) ──────────────────
      doc.rect(0, 0, 595, 130).fill(PRIMARY);
      doc.fillColor("white").font("Helvetica-Bold").fontSize(24).text(trip.name, MARGIN_X, 40, { width: CONTENT_WIDTH });

      const countries: string[] = (trip.countryStays ?? []).map((c: any) => c.country).filter(Boolean);
      const countriesLabel = countries.length ? countries.join(" · ") : trip.destination ?? "";

      const start = trip.startDate ? new Date(trip.startDate) : null;
      const end = trip.endDate ? new Date(trip.endDate) : null;
      const days = start && end ? Math.round((end.getTime() - start.getTime()) / 86400000) + 1 : null;
      const fmtShort = (d: Date) => d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
      const dateRangeLabel = start && end ? `${fmtShort(start)} — ${fmtShort(end)}${days ? ` · ${days} días` : ""}` : "";

      doc
        .fontSize(11)
        .font("Helvetica")
        .fillColor("#DBEAFE")
        .text([countriesLabel, dateRangeLabel].filter(Boolean).join("   ·   "), MARGIN_X, 78, { width: CONTENT_WIDTH });

      doc.x = MARGIN_X;
      doc.y = 145;

      // ── Itinerario ─────────────────────────────────
      sectionHeader("Itinerario");

      const planItems = [...(trip.planItems ?? [])].sort((a: any, b: any) => {
        const da = a.day ? new Date(a.day).getTime() : 0;
        const db = b.day ? new Date(b.day).getTime() : 0;
        if (da !== db) return da - db;
        const ta = a.startAt ? new Date(a.startAt).getTime() : Infinity;
        const tb = b.startAt ? new Date(b.startAt).getTime() : Infinity;
        return ta - tb;
      });

      if (!planItems.length) {
        doc.fontSize(10).font("Helvetica").fillColor(MUTED).text("Este viaje todavía no tiene actividades planificadas.", MARGIN_X, doc.y, { width: CONTENT_WIDTH });
      }

      let currentDayKey = "";
      for (const item of planItems) {
        const dayKey = item.day ? new Date(item.day).toDateString() : "__sin_fecha__";
        if (dayKey !== currentDayKey) {
          currentDayKey = dayKey;
          ensureSpace(36);
          doc.moveDown(0.5);
          const label = item.day ? fmtDateLong(new Date(item.day)) : "Sin fecha asignada";
          doc.font("Helvetica-Bold").fontSize(11);
          const pillWidth = doc.widthOfString(label) + 20;
          doc.roundedRect(MARGIN_X, doc.y, pillWidth, 20, 10).fill("#EFF6FF");
          doc.fillColor(PRIMARY_DARK).text(label, MARGIN_X + 10, doc.y + 5);
          doc.moveDown(0.9);
        }

        ensureSpace(34);

        const catColor = this.BUDGET_CATEGORY_DEFS.find((d) => d.key === this.categoryForPlanItem(item))?.color ?? MUTED_LIGHT;
        const rowX = MARGIN_X;
        const dotY = doc.y + 4;
        doc.circle(rowX + 3, dotY, 3).fill(catColor);

        const timeStart = fmtTime(item.startAt);
        const timeEnd = fmtTime(item.endAt);
        const timeLabel = timeStart ? (timeEnd ? `${timeStart} - ${timeEnd}` : timeStart) : null;
        const typeLabel = this.PLAN_ITEM_TYPE_LABELS[item.type] ?? item.type;

        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor(TEXT)
          .text(`${timeLabel ? `${timeLabel}  ·  ` : ""}${typeLabel} — ${item.title}`, rowX + 12, doc.y, { width: CONTENT_WIDTH - 12 });

        const details: string[] = [];
        if (item.location) details.push(item.location);

        if (item.flightDetails) {
          const f = item.flightDetails;
          const route = [f.fromIata, f.toIata].filter(Boolean).join(" → ");
          const line = [f.airlineName, f.flightNumberRaw, route].filter(Boolean).join(" · ");
          if (line) details.push(line);
        }
        if (item.accommodationDetails?.address) {
          details.push(item.accommodationDetails.address);
        }
        if (item.destinationTransport) {
          const t = item.destinationTransport;
          const route = [t.fromName, t.toName].filter(Boolean).join(" → ");
          if (route) details.push(route);
        }
        const stops = item.metadata?.stops;
        if (Array.isArray(stops) && stops.length) {
          details.push(`Paradas: ${stops.map((s: any) => s.label).filter(Boolean).join(", ")}`);
        }
        if (item.notes) details.push(item.notes);
        if (item.cost != null) {
          const costLabel = fmtEuro(item.cost);
          if (costLabel) details.push(`Coste: ${costLabel}`);
        }

        if (details.length) {
          doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(details.join("   ·   "), rowX + 12, doc.y, { width: CONTENT_WIDTH - 12 });
        }
        doc.moveDown(0.55);
      }

      // ── Alojamientos ─────────────────────────────
      const accommodations = planItems.filter((it: any) => it.accommodationDetails);
      if (accommodations.length) {
        sectionHeader("Alojamientos");
        const fmtDateTime = (iso: unknown) => {
          if (!iso) return null;
          const d = new Date(iso as string);
          if (isNaN(d.getTime())) return null;
          return `${d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" })}, ${d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
        };

        for (const item of accommodations) {
          ensureSpace(50);
          const a = item.accommodationDetails;
          doc.fontSize(10).font("Helvetica-Bold").fillColor(TEXT).text(item.title, MARGIN_X, doc.y, { width: CONTENT_WIDTH });

          const ci = fmtDateTime(a.checkInAt);
          const co = fmtDateTime(a.checkOutAt);
          if (ci || co) {
            doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(`Entrada ${ci ?? "-"}   ·   Salida ${co ?? "-"}`, MARGIN_X, doc.y, { width: CONTENT_WIDTH });
          }
          if (a.address) {
            doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(a.address, MARGIN_X, doc.y, { width: CONTENT_WIDTH });
          }
          const extra: string[] = [];
          if (a.guests) extra.push(`${a.guests} huésped${a.guests !== 1 ? "es" : ""}`);
          if (a.rooms) extra.push(`${a.rooms} habitación${a.rooms !== 1 ? "es" : ""}`);
          if (item.cost != null) {
            const costLabel = fmtEuro(item.cost);
            if (costLabel) extra.push(`Coste: ${costLabel}`);
          }
          if (extra.length) {
            doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(extra.join("   ·   "), MARGIN_X, doc.y, { width: CONTENT_WIDTH });
          }
          doc.moveDown(0.6);
        }
      }

      // ── Tareas ───────────────────────────────────
      const tasks = trip.tasks ?? [];
      if (tasks.length) {
        sectionHeader("Tareas");
        const taskRowHeight = 18;
        for (const task of tasks) {
          ensureSpace(taskRowHeight);
          const done = task.status === "done";
          const rowY = doc.y;
          doc.roundedRect(MARGIN_X, rowY + 1, 10, 10, 2).lineWidth(1).strokeColor(done ? "#16A34A" : BORDER).stroke();
          if (done) doc.roundedRect(MARGIN_X, rowY + 1, 10, 10, 2).fill("#16A34A");
          doc
            .fontSize(10)
            .font("Helvetica")
            .fillColor(done ? MUTED : TEXT)
            .text(task.title, MARGIN_X + 16, rowY, { width: CONTENT_WIDTH - 16 });
          doc.y = rowY + taskRowHeight;
        }
      }

      // ── Notas ────────────────────────────────────
      const notes = trip.notes ?? [];
      if (notes.length) {
        sectionHeader("Notas");
        for (const note of notes) {
          ensureSpace(30);
          if (note.title) {
            doc.fontSize(10).font("Helvetica-Bold").fillColor(TEXT).text(note.title, MARGIN_X, doc.y, { width: CONTENT_WIDTH });
          }
          doc.fontSize(10).font("Helvetica").fillColor(MUTED).text(note.body, MARGIN_X, doc.y, { width: CONTENT_WIDTH });
          doc.moveDown(0.4);
        }
      }

      // ── Gastos (página final, solo si se pidió incluir) ──
      // Usa los costes del planning (igual que la pestaña "Gastos" de la
      // app) categorizados, no las Transaction sueltas — ese es el gasto
      // real del viaje.
      if (includeExpenses) {
        doc.addPage();
        doc.x = MARGIN_X;
        doc.y = 50;

        doc.rect(MARGIN_X, doc.y + 2, 4, 20).fill(PRIMARY);
        doc.fontSize(18).font("Helvetica-Bold").fillColor(TEXT).text("Gastos", MARGIN_X + 12, doc.y);
        doc.moveDown(1);

        const entries = (trip.planItems ?? []).filter(
          (it: any) => !(it.metadata?.pending === true) && Number(it.cost) > 0,
        );
        const transactions: any[] = trip.transactions ?? [];
        const txTotal = transactions.reduce((s, tx) => s + (Number(tx.amount) || 0), 0);
        const entriesTotal = entries.reduce((s: number, it: any) => s + (Number(it.cost) || 0), 0);
        const totalSpent = entriesTotal + txTotal;

        if (!entries.length && !transactions.length) {
          doc.fontSize(10).font("Helvetica").fillColor(MUTED).text("Este viaje todavía no tiene gastos asignados en el planning.", MARGIN_X, doc.y, { width: CONTENT_WIDTH });
        } else {
          // Total + barra de presupuesto
          doc.fontSize(11).font("Helvetica").fillColor(MUTED).text("Total gastado", MARGIN_X, doc.y);
          doc.fontSize(26).font("Helvetica-Bold").fillColor(TEXT).text(fmtEuro(totalSpent) ?? "0 €", MARGIN_X, doc.y);
          doc.moveDown(0.3);

          if (trip.budget != null && trip.budget > 0) {
            const pct = Math.min(totalSpent / trip.budget, 1);
            const over = totalSpent > trip.budget;
            const barColor = over ? "#EF4444" : pct > 0.8 ? "#F59E0B" : "#22C55E";
            doc.roundedRect(MARGIN_X, doc.y, CONTENT_WIDTH, 6, 3).fill(BORDER);
            doc.roundedRect(MARGIN_X, doc.y, CONTENT_WIDTH * pct, 6, 3).fill(barColor);
            doc.moveDown(0.5);
            doc
              .fontSize(9)
              .font("Helvetica")
              .fillColor(over ? "#EF4444" : MUTED)
              .text(
                over
                  ? `${fmtEuro(totalSpent - trip.budget)} por encima del presupuesto de ${fmtEuro(trip.budget)}`
                  : `Queda ${fmtEuro(trip.budget - totalSpent)} de ${fmtEuro(trip.budget)}`,
                MARGIN_X,
                doc.y,
              );
          }

          // Desglose por categoría
          const totalsByCategory = new Map<string, number>();
          for (const it of entries) {
            const k = this.categoryForPlanItem(it);
            totalsByCategory.set(k, (totalsByCategory.get(k) ?? 0) + (Number(it.cost) || 0));
          }
          if (txTotal > 0) totalsByCategory.set("other", (totalsByCategory.get("other") ?? 0) + txTotal);

          const visibleCats = this.BUDGET_CATEGORY_DEFS
            .map((def) => ({ ...def, amount: totalsByCategory.get(def.key) ?? 0 }))
            .filter((d) => d.amount > 0)
            .sort((a, b) => b.amount - a.amount);

          if (visibleCats.length) {
            ensureSpace(30);
            doc.moveDown(0.9);
            doc.fontSize(12).font("Helvetica-Bold").fillColor(TEXT).text("Gastos por categoría", MARGIN_X, doc.y);
            doc.moveDown(0.4);

            for (const cat of visibleCats) {
              ensureSpace(30);
              const pct = totalSpent > 0 ? (cat.amount / totalSpent) * 100 : 0;
              const rowY = doc.y;
              doc.fontSize(10).font("Helvetica-Bold").fillColor(TEXT).text(cat.label, MARGIN_X, rowY, { width: 300 });
              doc
                .fontSize(10)
                .font("Helvetica-Bold")
                .fillColor(TEXT)
                .text(`${fmtEuro(cat.amount)}  (${Math.round(pct)}%)`, MARGIN_X + 300, rowY, { width: CONTENT_WIDTH - 300, align: "right" });
              doc.y = rowY + 15;
              doc.roundedRect(MARGIN_X, doc.y, CONTENT_WIDTH, 4, 2).fill(BORDER);
              doc.roundedRect(MARGIN_X, doc.y, CONTENT_WIDTH * (pct / 100), 4, 2).fill(cat.color);
              doc.y += 12;
            }
          }

          // Listado detallado
          const sortedEntries = [...entries].sort((a: any, b: any) => {
            const ta = a.startAt ? new Date(a.startAt).getTime() : a.day ? new Date(a.day).getTime() : 0;
            const tb = b.startAt ? new Date(b.startAt).getTime() : b.day ? new Date(b.day).getTime() : 0;
            return ta - tb;
          });

          ensureSpace(30);
          doc.moveDown(0.5);
          doc.fontSize(12).font("Helvetica-Bold").fillColor(TEXT).text("Detalle", MARGIN_X, doc.y);
          doc.moveDown(0.35);

          const rowHeight = 18;
          for (const it of sortedEntries) {
            ensureSpace(rowHeight);
            const catDef = this.BUDGET_CATEGORY_DEFS.find((d) => d.key === this.categoryForPlanItem(it));
            const rowY = doc.y;
            doc.circle(MARGIN_X + 3, rowY + 6, 3).fill(catDef?.color ?? MUTED_LIGHT);
            const dateLabel = it.day || it.startAt ? new Date(it.startAt ?? it.day).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }) : "";
            doc.fontSize(10).font("Helvetica").fillColor(TEXT).text(`${dateLabel ? `${dateLabel}   ` : ""}${it.title}`, MARGIN_X + 12, rowY, { width: 340 });
            doc.fontSize(10).font("Helvetica-Bold").fillColor(TEXT).text(fmtEuro(it.cost) ?? "", 400, rowY, { width: 95, align: "right" });
            doc.y = rowY + rowHeight;
          }

          // Transacciones adjuntadas (registradas), si las hay
          if (transactions.length) {
            ensureSpace(30);
            doc.moveDown(0.5);
            doc.fontSize(11).font("Helvetica-Bold").fillColor(MUTED).text("REGISTRADAS EN CARTERA", MARGIN_X, doc.y);
            doc.moveDown(0.35);

            const sortedTx = [...transactions].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            for (const tx of sortedTx) {
              ensureSpace(rowHeight);
              const amount = Number(tx.amount) || 0;
              const dateStr = new Date(tx.date).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
              const label = [tx.description, tx.category?.name].filter(Boolean).join(" · ") || "Gasto";
              const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "";
              const rowY = doc.y;
              doc.fontSize(10).font("Helvetica").fillColor(TEXT).text(`${dateStr}   ${label}`, MARGIN_X, rowY, { width: 340 });
              doc
                .fontSize(10)
                .font("Helvetica-Bold")
                .fillColor(tx.type === "income" ? "#16A34A" : TEXT)
                .text(`${sign}${fmtEuro(Math.abs(amount)) ?? ""}`, 400, rowY, { width: 95, align: "right" });
              doc.y = rowY + rowHeight;
            }
          }
        }
      }

      doc.end();
    });
  }



async createFlightPlanItemFromAutofill(
  userId: number,
  tripId: number,
  input: { flightNumber: string; date: string; cost?: number; currency?: string }
) {
  await this.assertTripOwnership(userId, tripId);

  const { flightNumber, date, cost, currency } = input;

  // valida date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new BadRequestException("date debe ser YYYY-MM-DD");
  }

  const f = await this.aerodatabox.getFlightByNumberAndDate(flightNumber, date);

  const tz = f?.from?.timezone ?? "Europe/Madrid";

  // start/end en UTC (correcto)
  const startAt = parseProviderLocalToUtcJsDate(f?.departureTimeLocal ?? null);
  const endAt = parseProviderLocalToUtcJsDate(f?.arrivalTimeLocal ?? null);

  // day: inicio del día LOCAL (del viaje), guardado en UTC
  const day = dayIsoToUtcStart(date, tz);

  // title robusto
  const fn = (f?.flightNumber ?? flightNumber ?? "").toString().trim().toUpperCase();
  const fromIata = (f?.from?.iata ?? "").toString().trim().toUpperCase();
  const toIata = (f?.to?.iata ?? "").toString().trim().toUpperCase();
  const title = `${fn}${fromIata && toIata ? ` · ${fromIata} → ${toIata}` : ""}`.trim();

  // location: aeropuerto origen
  const location = (f?.from?.airport ?? f?.from?.iata ?? null) as string | null;

  const created = await this.prisma.$transaction(async (tx) => {
    const planItem = await tx.tripPlanItem.create({
      data: {
        tripId,
        type: "flight",
        title,

        // ✅ NUEVOS
        day,
        startAt,
        endAt,
        timezone: tz,
        logistics: true,
        cost: cost ?? null,
        currency: currency ?? "EUR",

        // ✅ CAMPOS “UI”
        location,
        notes: null,

        // ✅ metadata opcional (si quieres)
        metadata: { source: "aerodatabox" },
      },
    });

    // ✅ IMPORTANTÍSIMO: crear FlightDetails SIEMPRE en autofill
    await tx.flightDetails.create({
      data: {
        planItemId: planItem.id,
        provider: "aerodatabox",
        status: f?.status ?? null,
        lastUpdatedUtc: f?.lastUpdatedUtc
          ? DateTime.fromISO(String(f.lastUpdatedUtc).replace(" ", "T"), { setZone: true }).toUTC().toJSDate()
          : null,

        flightNumberRaw: f?.flightNumber ?? fn,
        flightNumberIata: (flightNumber || "").replace(/\s+/g, "").toUpperCase(),

        airlineName: f?.airline ?? null,
        airlineIata: f?.airlineIata ?? null,

        fromIata: f?.from?.iata ?? null,
        toIata: f?.to?.iata ?? null,
        fromName: f?.from?.airport ?? null,
        toName: f?.to?.airport ?? null,
        fromCity: f?.from?.city ?? null,
        toCity: f?.to?.city ?? null,
        depTz: f?.from?.timezone ?? null,
        arrTz: f?.to?.timezone ?? null,

        depTerminal: f?.terminals?.departure ?? null,
        arrTerminal: f?.terminals?.arrival ?? null,

        aircraftModel: f?.aircraftModel ?? null,

        // schedule
        schedDepAt: startAt,
        schedArrAt: endAt,

        providerRaw: f as any, // o el raw completo si lo tienes
      },
    });

    return planItem;
  });

  await this.recomputeTripPlannedCost(tripId);

  return this.prisma.tripPlanItem.findUnique({
    where: { id: created.id },
    include: { flightDetails: true },
  });
}


async setPaymentStatus(
  tripId: number,
  planItemId: number,
  paymentStatus: PaymentStatus,
) {
  const item = await this.prisma.tripPlanItem.findFirst({
    where: {
      id: planItemId,
      tripId,
    },
  });

  if (!item) {
    throw new NotFoundException("Plan item not found");
  }

  return this.prisma.tripPlanItem.update({
    where: { id: planItemId },
    data: { paymentStatus },
  });
}

// =========================================================
// NOTES
// =========================================================

async listTripNotes(tripId: number) {
  return this.prisma.tripNote.findMany({
    where: { tripId },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

async createTripNote(tripId: number, dto: CreateTripNoteDto) {
  // body requerido por schema
  const body = (dto.body ?? "").trim();
  if (!body) throw new BadRequestException("body requerido");

  return this.prisma.tripNote.create({
    data: {
      tripId,
      title: dto.title?.trim() || null,
      body,
      pinned: dto.pinned ?? false,
    },
  });
}

async updateTripNote(tripId: number, noteId: number, dto: UpdateTripNoteDto) {
  const existing = await this.prisma.tripNote.findFirst({
    where: { id: noteId, tripId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundException("Note not found");

  const data: any = {};
  if (dto.title !== undefined) data.title = dto.title?.trim() || null;
  if (dto.body !== undefined) {
    const body = (dto.body ?? "").trim();
    if (!body) throw new BadRequestException("body no puede estar vacío");
    data.body = body;
  }
  if (dto.pinned !== undefined) data.pinned = dto.pinned;

  return this.prisma.tripNote.update({
    where: { id: noteId },
    data,
  });
}

async deleteTripNote(tripId: number, noteId: number) {
  const existing = await this.prisma.tripNote.findFirst({
    where: { id: noteId, tripId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundException("Note not found");

  await this.prisma.tripNote.delete({ where: { id: noteId } });
  return { success: true };
}

async setTripNotePinned(tripId: number, noteId: number, pinned: boolean) {
  const existing = await this.prisma.tripNote.findFirst({
    where: { id: noteId, tripId },
    select: { id: true, pinned: true },
  });
  if (!existing) throw new NotFoundException("Note not found");

  return this.prisma.tripNote.update({
    where: { id: noteId },
    data: { pinned },
  });
}

// =========================================================
// Trip documents (ej. seguro de viaje)
// =========================================================

async getTripDocuments(tripId: number) {
  return this.prisma.tripDocument.findMany({ where: { tripId } });
}

async upsertTripDocument(tripId: number, type: TripDocumentType, dto: UpsertTripDocumentDto) {
  // si viene planItemId, comprobamos que sea un plan item real de este viaje
  if (dto.planItemId != null) {
    const planItem = await this.prisma.tripPlanItem.findFirst({
      where: { id: dto.planItemId, tripId },
      select: { id: true },
    });
    if (!planItem) throw new BadRequestException("planItemId no pertenece a este viaje");
  }

  return this.prisma.tripDocument.upsert({
    where: { tripId_type: { tripId, type } },
    create: {
      tripId,
      type,
      provider: dto.provider ?? null,
      referenceCode: dto.referenceCode ?? null,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      planItemId: dto.planItemId ?? null,
    },
    update: {
      provider: dto.provider ?? null,
      referenceCode: dto.referenceCode ?? null,
      expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
      planItemId: dto.planItemId ?? null,
    },
  });
}

async deleteTripDocument(tripId: number, type: TripDocumentType) {
  await this.prisma.tripDocument.deleteMany({ where: { tripId, type } });
  return { success: true };
}

// =========================================================
// Trip contacts
// =========================================================

async listTripContacts(tripId: number) {
  return this.prisma.tripContact.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } });
}

async createTripContact(tripId: number, dto: CreateTripContactDto) {
  return this.prisma.tripContact.create({
    data: { tripId, name: dto.name.trim(), phone: dto.phone.trim(), notes: dto.notes?.trim() || null },
  });
}

async updateTripContact(tripId: number, contactId: number, dto: UpdateTripContactDto) {
  const existing = await this.prisma.tripContact.findFirst({ where: { id: contactId, tripId }, select: { id: true } });
  if (!existing) throw new NotFoundException("Contact not found");

  const data: any = {};
  if (dto.name !== undefined) data.name = dto.name.trim();
  if (dto.phone !== undefined) data.phone = dto.phone.trim();
  if (dto.notes !== undefined) data.notes = dto.notes?.trim() || null;

  return this.prisma.tripContact.update({ where: { id: contactId }, data });
}

async deleteTripContact(tripId: number, contactId: number) {
  const existing = await this.prisma.tripContact.findFirst({ where: { id: contactId, tripId }, select: { id: true } });
  if (!existing) throw new NotFoundException("Contact not found");

  await this.prisma.tripContact.delete({ where: { id: contactId } });
  return { success: true };
}

// =========================================================
// Trip checklist (Maleta)
// =========================================================

async listTripChecklist(tripId: number, userId: number) {
  try {
    return await this.prisma.tripChecklistItem.findMany({
      where: { tripId, userId },
      orderBy: [{ category: "asc" }, { order: "asc" }, { createdAt: "asc" }],
    });
  } catch (error) {
    this.wrapChecklistError(error);
  }
}

async seedTripChecklist(tripId: number, userId: number, dto: SeedTripChecklistDto) {
  try {
    const items = dto.items
      .map((item, index) => ({
        tripId,
        userId,
        category: item.category,
        label: item.label.trim(),
        order: item.order ?? index,
      }))
      .filter((item) => item.label.length > 0);

    if (!items.length) {
      throw new BadRequestException("Debes enviar al menos un artículo válido.");
    }

    const existingCount = await this.prisma.tripChecklistItem.count({ where: { tripId, userId } });
    if (existingCount > 0) return this.listTripChecklist(tripId, userId);

    await this.prisma.tripChecklistItem.createMany({ data: items });
    return this.listTripChecklist(tripId, userId);
  } catch (error) {
    this.wrapChecklistError(error);
  }
}

async createTripChecklistItem(tripId: number, userId: number, dto: CreateTripChecklistItemDto) {
  const label = dto.label.trim();
  if (!label) throw new BadRequestException("El artículo no puede estar vacío.");

  try {
    const lastItem = await this.prisma.tripChecklistItem.findFirst({
      where: { tripId, userId, category: dto.category },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    return await this.prisma.tripChecklistItem.create({
      data: {
        tripId,
        userId,
        category: dto.category,
        label,
        order: dto.order ?? (lastItem?.order ?? -1) + 1,
      },
    });
  } catch (error) {
    this.wrapChecklistError(error);
  }
}

async updateTripChecklistItem(tripId: number, userId: number, itemId: number, dto: UpdateTripChecklistItemDto) {
  const existing = await this.prisma.tripChecklistItem.findFirst({ where: { id: itemId, tripId, userId }, select: { id: true } });
  if (!existing) throw new NotFoundException("Checklist item not found");

  const data: any = {};
  if (dto.label !== undefined) {
    const label = dto.label.trim();
    if (!label) throw new BadRequestException("El artículo no puede estar vacío.");
    data.label = label;
  }
  if (dto.checked !== undefined) data.checked = dto.checked;
  if (dto.order !== undefined) data.order = dto.order;

  try {
    return await this.prisma.tripChecklistItem.update({ where: { id: itemId }, data });
  } catch (error) {
    this.wrapChecklistError(error);
  }
}

async deleteTripChecklistItem(tripId: number, userId: number, itemId: number) {
  const existing = await this.prisma.tripChecklistItem.findFirst({ where: { id: itemId, tripId, userId }, select: { id: true } });
  if (!existing) throw new NotFoundException("Checklist item not found");

  try {
    await this.prisma.tripChecklistItem.delete({ where: { id: itemId } });
  } catch (error) {
    this.wrapChecklistError(error);
  }
  return { success: true };
}

// =========================================================
// TASKS
// =========================================================

async listTripTasks(tripId: number, status?: TaskStatus) {
  return this.prisma.tripTask.findMany({
    where: {
      tripId,
      ...(status ? { status } : {}),
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
  });
}

async createTripTask(tripId: number, dto: CreateTripTaskDto) {
  const title = (dto.title ?? "").trim();
  if (!title) throw new BadRequestException("title requerido");

  return this.prisma.tripTask.create({
    data: {
      tripId,
      title,
      status: dto.status ?? TaskStatus.to_do,
      priority: dto.priority ?? null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    },
  });
}

async updateTripTask(tripId: number, taskId: number, dto: UpdateTripTaskDto) {
  const existing = await this.prisma.tripTask.findFirst({
    where: { id: taskId, tripId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundException("Task not found");

  const data: any = {};
  if (dto.title !== undefined) {
    const title = (dto.title ?? "").trim();
    if (!title) throw new BadRequestException("title no puede estar vacío");
    data.title = title;
  }
  if (dto.status !== undefined) data.status = dto.status;
  if (dto.priority !== undefined) data.priority = dto.priority ?? null;
  if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;

  return this.prisma.tripTask.update({
    where: { id: taskId },
    data,
  });
}

async deleteTripTask(tripId: number, taskId: number) {
  const existing = await this.prisma.tripTask.findFirst({
    where: { id: taskId, tripId },
    select: { id: true },
  });
  if (!existing) throw new NotFoundException("Task not found");

  await this.prisma.tripTask.delete({ where: { id: taskId } });
  return { success: true };
}

async toggleTripTaskStatus(tripId: number, taskId: number) {
  const existing = await this.prisma.tripTask.findFirst({
    where: { id: taskId, tripId },
    select: { id: true, status: true },
  });
  if (!existing) throw new NotFoundException("Task not found");

  const next = existing.status === TaskStatus.done ? TaskStatus.to_do : TaskStatus.done;

  return this.prisma.tripTask.update({
    where: { id: taskId },
    data: { status: next },
  });
}



async getContinentsStats(userId: number) {
  // 1) Trae los stays (país + continente propios) de cada viaje visto —
  // un viaje puede tener varios países, cada uno con su propio continente.
  const seenStays = await this.prisma.tripCountryStay.findMany({
    where: {
      trip: { userId, status: "seen" as any },
    },
    select: {
      tripId: true,
      country: true,
      continent: true,
    },
  });

  // 2) Agrupa en Sets (únicos) por continente; un mismo viaje puede sumar
  // "1 viaje visto" a más de un continente si sus países están repartidos.
  const visitedSets = new Map<ContinentKey, Set<string>>();
  const tripsByContinent = new Map<ContinentKey, Set<number>>();

  for (const s of seenStays) {
    const rawC = (s.continent || "").toString().toLowerCase().trim();
    const key: ContinentKey = (CONTINENTS_ORDER.includes(rawC as any) ? rawC : "unknown") as ContinentKey;

    const code = (s.country || "").trim().toUpperCase();
    if (!code) continue;

    if (!visitedSets.has(key)) visitedSets.set(key, new Set());
    visitedSets.get(key)!.add(code);

    if (!tripsByContinent.has(key)) tripsByContinent.set(key, new Set());
    tripsByContinent.get(key)!.add(s.tripId);
  }

  // 3) Devuelve en formato listo para el front: visited/total + pct + trips
  const rows = CONTINENTS_ORDER.map((continent) => {
    const visited = visitedSets.get(continent)?.size ?? 0;
    const total = TOTAL_COUNTRIES_BY_CONTINENT[continent] ?? 0;

    return {
      continent,                // "europe"
      visitedCountries: visited, // 31
      totalCountries: total,     // 52
      pct: safePct(visited, total), // 67
      trips: tripsByContinent.get(continent)?.size ?? 0, // nº de viajes distintos con algún país en este continente
    };
  });

  // si quieres ordenar de más a menos por % o por visited:
  // rows.sort((a,b)=> b.visitedCountries - a.visitedCountries);

  return rows;
}



}
