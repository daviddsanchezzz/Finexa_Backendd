import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { COUNTRIES, CONTINENT_ORDER, safePct, WorldContinent } from "./data/countries.data";
import { WONDERS_CATALOG } from "./data/wonders.data";
import { UpdateWonderVisitDto } from "./dto/update-wonder-visit.dto";

function displayNameEs(code: string): string {
  try {
    return new Intl.DisplayNames(["es"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

@Injectable()
export class WorldService {
  constructor(private prisma: PrismaService) {}

  private async getVisitedCountryCodes(userId: number): Promise<Set<string>> {
    const seenTrips = await this.prisma.trip.findMany({
      where: { userId, status: "seen" as any, destination: { not: null } },
      select: { destination: true },
    });
    return new Set(
      seenTrips.map((t) => (t.destination || "").trim().toUpperCase()).filter(Boolean),
    );
  }

  async getCountries(userId: number) {
    const visitedCodes = await this.getVisitedCountryCodes(userId);

    const byContinent = new Map<WorldContinent, typeof COUNTRIES>();
    for (const country of COUNTRIES) {
      if (!byContinent.has(country.continent)) byContinent.set(country.continent, []);
      byContinent.get(country.continent)!.push(country);
    }

    return CONTINENT_ORDER.map((continent) => {
      const list = byContinent.get(continent) ?? [];
      const countries = list.map((c) => ({
        code: c.code,
        nameEs: displayNameEs(c.code),
        visited: visitedCodes.has(c.code),
      }));
      const visited = countries.filter((c) => c.visited).length;
      return {
        continent,
        countries,
        visited,
        total: countries.length,
        pct: safePct(visited, countries.length),
      };
    });
  }

  async getOverview(userId: number) {
    const continents = await this.getCountries(userId);
    const totalCountries = COUNTRIES.length;
    const visitedCountries = continents.reduce((sum, c) => sum + c.visited, 0);
    const wondersVisited = await this.prisma.wonderVisit.count({ where: { userId } });

    return {
      visitedPct: safePct(visitedCountries, totalCountries),
      visitedCountries,
      totalCountries,
      continents: continents.map(({ continent, visited, total, pct }) => ({
        continent,
        visited,
        total,
        pct,
      })),
      wondersVisited,
      wondersTotal: WONDERS_CATALOG.length,
    };
  }

  async getWonders(userId: number) {
    const visits = await this.prisma.wonderVisit.findMany({ where: { userId } });
    const byKey = new Map(visits.map((v) => [v.wonderKey, v]));

    return WONDERS_CATALOG.map((w) => {
      const visit = byKey.get(w.key);
      return {
        key: w.key,
        name: w.name,
        country: w.country,
        era: w.era,
        visited: !!visit,
        visitedAt: visit?.visitedAt ? visit.visitedAt.toISOString() : null,
        photoUrl: visit?.photoUrl ?? null,
        tripId: visit?.tripId ?? null,
      };
    });
  }

  async upsertWonderVisit(userId: number, wonderKey: string, dto: UpdateWonderVisitDto) {
    const catalogItem = WONDERS_CATALOG.find((w) => w.key === wonderKey);
    if (!catalogItem) {
      throw new NotFoundException(`Unknown wonder key: ${wonderKey}`);
    }

    if (!dto.visited) {
      await this.prisma.wonderVisit.deleteMany({ where: { userId, wonderKey } });
    } else {
      await this.prisma.wonderVisit.upsert({
        where: { userId_wonderKey: { userId, wonderKey } },
        create: {
          userId,
          wonderKey,
          visitedAt: dto.visitedAt ? new Date(dto.visitedAt) : new Date(),
          photoUrl: dto.photoUrl ?? null,
          tripId: dto.tripId ?? null,
        },
        update: {
          visitedAt: dto.visitedAt ? new Date(dto.visitedAt) : new Date(),
          photoUrl: dto.photoUrl ?? null,
          tripId: dto.tripId ?? null,
        },
      });
    }

    const wonders = await this.getWonders(userId);
    return wonders.find((w) => w.key === wonderKey)!;
  }
}
