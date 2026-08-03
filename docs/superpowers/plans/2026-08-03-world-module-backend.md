# World Module (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `world` module to the NestJS backend exposing países-visitados/continent-breakdown data and a fixed 14-item "world wonders" catalog with per-user visit tracking (photo + date), backing the new "Tu mundo" screens in the frontend.

**Architecture:** New self-contained `src/modules/world/` module (controller + service + DTO), two static reference-data files (195-country list by continent, 14-item wonders catalog), one new Prisma model (`WonderVisit`). Existing `/trips/summary` and `/trips/continents-stats` endpoints are left untouched — the new module reimplements the country/continent aggregation independently, sourced from `Trip.destination`/`Trip.status` exactly like those existing endpoints do, but grouped into the 5-continent scheme (`europe`/`asia`/`america`/`africa`/`oceania`) used by the new UI instead of the existing 7-bucket scheme. Additionally, the existing `GET /trips` endpoint gets an optional `?country=` filter for the wonder-detail "vincular a viaje" selector.

**Tech Stack:** NestJS, Prisma, class-validator, Jest (unit tests for pure data/logic only — this backend's existing convention is to unit-test pure functions and leave controllers/services verified manually, since no Nest `TestingModule` usage exists anywhere in the repo).

## Global Constraints

- `userId` is `Int` everywhere (Prisma `User.id` is `Int @id @default(autoincrement())`), not string/UUID — never use `cuid()`/string ids for new models.
- Auth: every controller is protected by the global `JwtAuthGuard` by default (`src/main.ts`); get the caller's id via `@User("id") userId: number` from `src/common/decorators/user.decorator.ts` — no manual guard decorators needed, no `req.user`.
- Validation: `class-validator` decorators on DTOs, wired globally via `ValidationPipe({ whitelist: true, transform: true })` — no Zod.
- Country codes are always 2-letter uppercase ISO2 strings (matches `Trip.destination`'s existing convention).
- Do not modify `TripsService.getSummary` or `TripsService.getContinentsStats` — they remain in use by `TravelsScreen`/`TripsHomeDesktopScreen` unchanged.
- Migrations: `npx prisma migrate dev --name <snake_case_name>`, run from the `spendly-backend` repo root (the actual repo root is `c:\PROYECTOS\Spendly_fronted_dev\spendly-backend` — note this folder also happens to contain an empty stray `spendly-backend` subfolder from earlier exploration; ignore/do not create files there).
- Test command: `npm test` (Jest, `testRegex: '.*\.spec\.ts$'`, rootDir `src`).

---

### Task 1: `WonderVisit` Prisma model + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma model `WonderVisit` with fields `id: Int`, `userId: Int`, `wonderKey: String`, `visitedAt: DateTime?`, `photoUrl: String?`, `tripId: Int?`, `createdAt: DateTime`, `updatedAt: DateTime`, unique constraint `@@unique([userId, wonderKey])` (Prisma Client compound-key name: `userId_wonderKey`). Later tasks (`WorldService`) call `this.prisma.wonderVisit.findMany/upsert/deleteMany/count`.

- [ ] **Step 1: Add the `WonderVisit` model**

Open `prisma/schema.prisma` and add this model after the `Trip`-related models (e.g. right after the closing brace of `model TripChecklistItem` if present, or after `model Trip` — anywhere alongside the other trip-adjacent models is fine):

```prisma
model WonderVisit {
  id        Int       @id @default(autoincrement())
  userId    Int
  wonderKey String
  visitedAt DateTime?
  photoUrl  String?
  tripId    Int?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  user User  @relation(fields: [userId], references: [id], onDelete: Cascade)
  trip Trip? @relation(fields: [tripId], references: [id], onDelete: SetNull)

  @@unique([userId, wonderKey])
  @@index([userId])
}
```

- [ ] **Step 2: Add the inverse relation fields**

In `model User { ... }`, find the line `documents UserDocument[]` (an existing per-user child-relation array) and add immediately after it:

```prisma
  wonderVisits WonderVisit[]
```

In `model Trip { ... }`, find the line `checklistItems TripChecklistItem[]` and add immediately after it:

```prisma
  wonderVisits WonderVisit[]
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name add_wonder_visits`
Expected: migration succeeds, prints `Your database is now in sync with your schema.`, and creates a new folder under `prisma/migrations/` named `<timestamp>_add_wonder_visits`.

- [ ] **Step 4: Verify the schema is valid and the client regenerated**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid 🚀`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(world): add WonderVisit model and migration"
```

---

### Task 2: Static country reference data + continent breakdown helper (TDD)

**Files:**
- Create: `src/modules/world/data/countries.data.ts`
- Test: `src/modules/world/data/countries.data.spec.ts`

**Interfaces:**
- Produces: `export type WorldContinent = "europe" | "africa" | "asia" | "america" | "oceania"`, `export interface WorldCountry { code: string; continent: WorldContinent }`, `export const COUNTRIES: WorldCountry[]` (195 entries), `export const CONTINENT_ORDER: WorldContinent[]` (`["europe","asia","america","africa","oceania"]`), `export function safePct(num: number, den: number): number`. Task 4 (`WorldService`) imports all four.

- [ ] **Step 1: Write the failing test**

Create `src/modules/world/data/countries.data.spec.ts`:

```ts
import { COUNTRIES, CONTINENT_ORDER, safePct } from './countries.data';

describe('countries.data', () => {
  it('has exactly 195 countries with no duplicate codes', () => {
    expect(COUNTRIES.length).toBe(195);
    const codes = new Set(COUNTRIES.map((c) => c.code));
    expect(codes.size).toBe(195);
  });

  it('splits countries per continent matching the expected reference totals', () => {
    const counts = CONTINENT_ORDER.reduce((acc, continent) => {
      acc[continent] = COUNTRIES.filter((c) => c.continent === continent).length;
      return acc;
    }, {} as Record<string, number>);

    expect(counts).toEqual({
      europe: 44,
      asia: 48,
      america: 35,
      africa: 54,
      oceania: 14,
    });
  });

  it('every country code is a valid 2-letter uppercase ISO code', () => {
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('safePct', () => {
  it('returns 0 when denominator is 0 or negative', () => {
    expect(safePct(5, 0)).toBe(0);
    expect(safePct(5, -1)).toBe(0);
  });
  it('rounds to nearest integer percentage', () => {
    expect(safePct(1, 3)).toBe(33);
    expect(safePct(2, 3)).toBe(67);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- countries.data.spec.ts`
Expected: FAIL — `Cannot find module './countries.data'`

- [ ] **Step 3: Write the implementation**

Create `src/modules/world/data/countries.data.ts`:

```ts
export type WorldContinent = "europe" | "africa" | "asia" | "america" | "oceania";

export interface WorldCountry {
  code: string;
  continent: WorldContinent;
}

const EUROPE: string[] = ["AL","AD","AT","BY","BE","BA","BG","HR","CZ","DK","EE","FI","FR","DE","GR","HU","IS","IE","IT","LV","LI","LT","LU","MT","MD","MC","ME","NL","MK","NO","PL","PT","RO","RU","SM","RS","SK","SI","ES","SE","CH","UA","GB","VA"];
const AFRICA: string[] = ["DZ","AO","BJ","BW","BF","BI","CV","CM","CF","TD","KM","CG","CD","DJ","EG","GQ","ER","SZ","ET","GA","GM","GH","GN","GW","CI","KE","LS","LR","LY","MG","MW","ML","MR","MU","MA","MZ","NA","NE","NG","RW","ST","SN","SC","SL","SO","ZA","SS","SD","TZ","TG","TN","UG","ZM","ZW"];
const ASIA: string[] = ["AF","AM","AZ","BH","BD","BT","BN","KH","CN","CY","GE","IN","ID","IR","IQ","IL","JP","JO","KZ","KW","KG","LA","LB","MY","MV","MN","MM","NP","KP","OM","PK","PS","PH","QA","SA","SG","KR","LK","SY","TJ","TH","TL","TR","TM","AE","UZ","VN","YE"];
const AMERICA: string[] = ["AG","BS","BB","BZ","CA","CR","CU","DM","DO","SV","GD","GT","HT","HN","JM","MX","NI","PA","KN","LC","VC","TT","US","AR","BO","BR","CL","CO","EC","GY","PY","PE","SR","UY","VE"];
const OCEANIA: string[] = ["AU","FJ","KI","MH","FM","NR","NZ","PW","PG","WS","SB","TO","TV","VU"];

export const CONTINENT_ORDER: WorldContinent[] = ["europe", "asia", "america", "africa", "oceania"];

export const COUNTRIES: WorldCountry[] = [
  ...EUROPE.map((code) => ({ code, continent: "europe" as const })),
  ...ASIA.map((code) => ({ code, continent: "asia" as const })),
  ...AMERICA.map((code) => ({ code, continent: "america" as const })),
  ...AFRICA.map((code) => ({ code, continent: "africa" as const })),
  ...OCEANIA.map((code) => ({ code, continent: "oceania" as const })),
];

export function safePct(num: number, den: number): number {
  if (!den || den <= 0) return 0;
  return Math.round((num / den) * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- countries.data.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/data/countries.data.ts src/modules/world/data/countries.data.spec.ts
git commit -m "feat(world): add static 195-country reference data by continent"
```

---

### Task 3: Wonders catalog data (TDD)

**Files:**
- Create: `src/modules/world/data/wonders.data.ts`
- Test: `src/modules/world/data/wonders.data.spec.ts`

**Interfaces:**
- Produces: `export type WonderEra = "modern" | "ancient"`, `export interface WonderCatalogItem { key: string; name: string; country: string; era: WonderEra }`, `export const WONDERS_CATALOG: WonderCatalogItem[]` (14 entries). Task 4 (`WorldService`) imports `WONDERS_CATALOG` and `WonderEra`.

- [ ] **Step 1: Write the failing test**

Create `src/modules/world/data/wonders.data.spec.ts`:

```ts
import { WONDERS_CATALOG } from './wonders.data';

describe('wonders.data', () => {
  it('has exactly 14 wonders with unique keys', () => {
    expect(WONDERS_CATALOG.length).toBe(14);
    const keys = new Set(WONDERS_CATALOG.map((w) => w.key));
    expect(keys.size).toBe(14);
  });

  it('has exactly 7 modern and 7 ancient wonders', () => {
    expect(WONDERS_CATALOG.filter((w) => w.era === 'modern').length).toBe(7);
    expect(WONDERS_CATALOG.filter((w) => w.era === 'ancient').length).toBe(7);
  });

  it('every wonder has a valid 2-letter uppercase ISO country code', () => {
    for (const w of WONDERS_CATALOG) {
      expect(w.country).toMatch(/^[A-Z]{2}$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wonders.data.spec.ts`
Expected: FAIL — `Cannot find module './wonders.data'`

- [ ] **Step 3: Write the implementation**

Create `src/modules/world/data/wonders.data.ts`:

```ts
export type WonderEra = "modern" | "ancient";

export interface WonderCatalogItem {
  key: string;
  name: string;
  country: string;
  era: WonderEra;
}

export const WONDERS_CATALOG: WonderCatalogItem[] = [
  { key: "great_wall_china", name: "Gran Muralla China", country: "CN", era: "modern" },
  { key: "petra", name: "Petra", country: "JO", era: "modern" },
  { key: "christ_redeemer", name: "Cristo Redentor", country: "BR", era: "modern" },
  { key: "machu_picchu", name: "Machu Picchu", country: "PE", era: "modern" },
  { key: "chichen_itza", name: "Chichén Itzá", country: "MX", era: "modern" },
  { key: "colosseum", name: "Coliseo", country: "IT", era: "modern" },
  { key: "taj_mahal", name: "Taj Mahal", country: "IN", era: "modern" },
  { key: "great_pyramid_giza", name: "Gran Pirámide de Guiza", country: "EG", era: "ancient" },
  { key: "hanging_gardens_babylon", name: "Jardines Colgantes de Babilonia", country: "IQ", era: "ancient" },
  { key: "statue_zeus", name: "Estatua de Zeus", country: "GR", era: "ancient" },
  { key: "temple_artemis", name: "Templo de Artemisa", country: "TR", era: "ancient" },
  { key: "mausoleum_halicarnassus", name: "Mausoleo de Halicarnaso", country: "TR", era: "ancient" },
  { key: "colossus_rhodes", name: "Coloso de Rodas", country: "GR", era: "ancient" },
  { key: "lighthouse_alexandria", name: "Faro de Alejandría", country: "EG", era: "ancient" },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- wonders.data.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/data/wonders.data.ts src/modules/world/data/wonders.data.spec.ts
git commit -m "feat(world): add fixed 14-item world wonders catalog"
```

---

### Task 4: `WorldService` + `WorldController` read endpoints + module registration

**Files:**
- Create: `src/modules/world/world.service.ts`
- Create: `src/modules/world/world.controller.ts`
- Create: `src/modules/world/world.module.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `COUNTRIES`, `CONTINENT_ORDER`, `safePct`, `WorldContinent` from `./data/countries.data` (Task 2); `WONDERS_CATALOG`, `WonderEra` from `./data/wonders.data` (Task 3); `PrismaService` from `src/common/prisma/prisma.service`; `User` decorator from `src/common/decorators/user.decorator`.
- Produces: `WorldService.getCountries(userId): Promise<{continent, countries: {code,nameEs,visited}[], visited, total, pct}[]>`, `WorldService.getOverview(userId): Promise<{visitedPct, visitedCountries, totalCountries, continents: {continent,visited,total,pct}[], wondersVisited, wondersTotal}>`, `WorldService.getWonders(userId): Promise<{key,name,country,era,visited,visitedAt,photoUrl,tripId}[]>` — all consumed by Task 5 (`upsertWonderVisit` reuses `getWonders`) and by the frontend plan's screens.
- Endpoints: `GET /world/overview`, `GET /world/countries`, `GET /world/wonders`.

- [ ] **Step 1: Write `WorldService` read methods**

Create `src/modules/world/world.service.ts`:

```ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/common/prisma/prisma.service";
import { COUNTRIES, CONTINENT_ORDER, safePct, WorldContinent } from "./data/countries.data";
import { WONDERS_CATALOG } from "./data/wonders.data";

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
}
```

- [ ] **Step 2: Write `WorldController`**

Create `src/modules/world/world.controller.ts`:

```ts
import { Controller, Get } from "@nestjs/common";
import { User } from "src/common/decorators/user.decorator";
import { WorldService } from "./world.service";

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
}
```

- [ ] **Step 3: Write `WorldModule`**

Create `src/modules/world/world.module.ts`:

```ts
import { Module } from "@nestjs/common";
import { PrismaModule } from "../../common/prisma/prisma.module";
import { WorldService } from "./world.service";
import { WorldController } from "./world.controller";

@Module({
  imports: [PrismaModule],
  controllers: [WorldController],
  providers: [WorldService],
})
export class WorldModule {}
```

- [ ] **Step 4: Register `WorldModule` in `app.module.ts`**

Modify `src/app.module.ts`: add the import line

```ts
import { WorldModule } from './modules/world/world.module';
```

and add `WorldModule` to the `imports: [...]` array (anywhere in the list, order doesn't matter — e.g. right after `TripsModule`).

- [ ] **Step 5: Manual verification (no controller/service test convention exists in this repo — mirror it, don't introduce one)**

Run: `npm run start:dev` (or the repo's existing dev script), then in another terminal:

```bash
# get a token first
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H "Content-Type: application/json" -d '{"email":"<your-test-user-email>","password":"<your-test-user-password>"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).access_token")

curl -s http://localhost:3000/world/overview -H "Authorization: Bearer $TOKEN" | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')), null, 2)"
curl -s http://localhost:3000/world/countries -H "Authorization: Bearer $TOKEN" | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')), null, 2)"
curl -s http://localhost:3000/world/wonders -H "Authorization: Bearer $TOKEN" | node -pe "JSON.stringify(JSON.parse(require('fs').readFileSync(0,'utf8')), null, 2)"
```

Expected: `/world/overview` returns `{ visitedPct, visitedCountries, totalCountries: 195, continents: [5 rows], wondersVisited: 0, wondersTotal: 14 }`; `/world/countries` returns 5 continent groups totalling 195 countries; `/world/wonders` returns 14 items all with `visited: false`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/world/world.service.ts src/modules/world/world.controller.ts src/modules/world/world.module.ts src/app.module.ts
git commit -m "feat(world): add GET /world/overview, /world/countries, /world/wonders"
```

---

### Task 5: `PATCH /world/wonders/:key` (mark/unmark a wonder as visited)

**Files:**
- Create: `src/modules/world/dto/update-wonder-visit.dto.ts`
- Modify: `src/modules/world/world.service.ts`
- Modify: `src/modules/world/world.controller.ts`

**Interfaces:**
- Consumes: `WorldService.getWonders` (Task 4), `WONDERS_CATALOG` (Task 3), Prisma `wonderVisit.upsert`/`deleteMany` (Task 1's model).
- Produces: `WorldService.upsertWonderVisit(userId: number, wonderKey: string, dto: UpdateWonderVisitDto): Promise<WonderDto>` and `PATCH /world/wonders/:key`, consumed by the frontend `useWonders` hook (frontend plan, Task 3).

- [ ] **Step 1: Write the DTO**

Create `src/modules/world/dto/update-wonder-visit.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsDateString, IsString, IsInt } from "class-validator";

export class UpdateWonderVisitDto {
  @IsBoolean()
  visited: boolean;

  @IsOptional()
  @IsDateString()
  visitedAt?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  @IsOptional()
  @IsInt()
  tripId?: number;
}
```

- [ ] **Step 2: Add `upsertWonderVisit` to `WorldService`**

Modify `src/modules/world/world.service.ts`: add the import

```ts
import { NotFoundException } from "@nestjs/common";
```

(merge into the existing `import { Injectable } from "@nestjs/common";` line as `import { Injectable, NotFoundException } from "@nestjs/common";`), add

```ts
import { UpdateWonderVisitDto } from "./dto/update-wonder-visit.dto";
```

and add this method to the `WorldService` class, after `getWonders`:

```ts
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
```

- [ ] **Step 3: Add the controller endpoint**

Modify `src/modules/world/world.controller.ts`: change the import line to

```ts
import { Controller, Get, Patch, Param, Body } from "@nestjs/common";
```

add

```ts
import { UpdateWonderVisitDto } from "./dto/update-wonder-visit.dto";
```

and add this method to `WorldController`, after `getWonders`:

```ts
  @Patch("wonders/:key")
  updateWonder(
    @User("id") userId: number,
    @Param("key") key: string,
    @Body() dto: UpdateWonderVisitDto,
  ) {
    return this.worldService.upsertWonderVisit(userId, key, dto);
  }
```

- [ ] **Step 4: Manual verification**

With the dev server running and `$TOKEN` set (see Task 4 Step 5):

```bash
curl -s -X PATCH http://localhost:3000/world/wonders/machu_picchu \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"visited": true, "visitedAt": "2023-03-15"}'
```
Expected: returns the `machu_picchu` wonder with `visited: true`, `visitedAt: "2023-03-15T00:00:00.000Z"`.

```bash
curl -s http://localhost:3000/world/overview -H "Authorization: Bearer $TOKEN"
```
Expected: `wondersVisited` is now `1`.

```bash
curl -s -X PATCH http://localhost:3000/world/wonders/machu_picchu \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"visited": false}'
```
Expected: returns the wonder with `visited: false`, and a follow-up `GET /world/overview` shows `wondersVisited: 0` again.

```bash
curl -s -X PATCH http://localhost:3000/world/wonders/not_a_real_key \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"visited": true}'
```
Expected: `404` with `"Unknown wonder key: not_a_real_key"`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/world/dto/update-wonder-visit.dto.ts src/modules/world/world.service.ts src/modules/world/world.controller.ts
git commit -m "feat(world): add PATCH /world/wonders/:key to mark/unmark a visit"
```

---

### Task 6: `GET /trips` — add optional `?country=` filter

**Files:**
- Modify: `src/modules/trips/trips.controller.ts:49-52`
- Modify: `src/modules/trips/trips.service.ts:174-180`

**Interfaces:**
- Produces: `TripsService.getTrips(userId: number, country?: string)` — `country` filters to trips whose `destination` matches (case-insensitive). Consumed by the frontend's `WonderDetailScreen` (frontend plan, Task 4) to populate the "vincular a viaje" selector.

- [ ] **Step 1: Modify `TripsService.getTrips`**

In `src/modules/trips/trips.service.ts`, replace lines 174-180:

```ts
  async getTrips(userId: number) {
    // si no hay fechas, ordena por createdAt para wishlist
    return this.prisma.trip.findMany({
      where: { userId },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
  }
```

with:

```ts
  async getTrips(userId: number, country?: string) {
    // si no hay fechas, ordena por createdAt para wishlist
    return this.prisma.trip.findMany({
      where: {
        userId,
        ...(country ? { destination: country.trim().toUpperCase() } : {}),
      },
      orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    });
  }
```

- [ ] **Step 2: Modify `TripsController.getTrips`**

In `src/modules/trips/trips.controller.ts`, replace lines 49-52:

```ts
  @Get()
  getTrips(@User("id") userId: number) {
    return this.tripsService.getTrips(userId);
  }
```

with:

```ts
  @Get()
  getTrips(@User("id") userId: number, @Query("country") country?: string) {
    return this.tripsService.getTrips(userId, country);
  }
```

(`Query` is already imported at the top of this file — no import change needed.)

- [ ] **Step 3: Manual verification**

```bash
curl -s "http://localhost:3000/trips" -H "Authorization: Bearer $TOKEN"
curl -s "http://localhost:3000/trips?country=pe" -H "Authorization: Bearer $TOKEN"
```
Expected: the first call returns all of the user's trips; the second returns only trips with `destination: "PE"` (case-insensitive input, e.g. lowercase `pe` still matches), and an unrelated country code returns `[]`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trips/trips.controller.ts src/modules/trips/trips.service.ts
git commit -m "feat(trips): support filtering GET /trips by destination country"
```

---

## Plan Self-Review

**Spec coverage:** `/world/overview`, `/world/countries`, `/world/wonders`, `PATCH /world/wonders/:key` (Tasks 4-5) ✓; `WonderVisit` model (Task 1) ✓; fixed 195-country and 14-wonder static data (Tasks 2-3) ✓; trip-linker country filter (Task 6) ✓; existing `/trips/summary`/`/trips/continents-stats` left untouched (stated in Global Constraints, no task touches them) ✓.

**Placeholder scan:** no TBD/TODO; all code blocks are complete, real, copy-pasteable.

**Type consistency:** `WorldContinent`, `WonderEra`, `WONDERS_CATALOG`, `COUNTRIES`, `CONTINENT_ORDER`, `safePct` are defined once (Tasks 2-3) and imported with matching names in every later task. `WorldService` method names (`getOverview`, `getCountries`, `getWonders`, `upsertWonderVisit`) are consistent between their definition (Tasks 4-5) and controller usage.
