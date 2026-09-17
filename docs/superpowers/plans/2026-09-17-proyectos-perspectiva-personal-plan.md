# Proyectos: perspectiva personal (segundo ajuste) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Nota de este proyecto:** el usuario ha pedido explícitamente NO usar el ciclo completo de subagent-driven-development (dispatch de implementador+revisor por tarea) — implementar directamente en la sesión principal, tarea a tarea, verificando con typecheck/tests rápidos y no repitiendo verificación manual (dev server/curl) tras cada cambio.

**Goal:** Cambiar la pantalla general de Proyectos para priorizar "cuánto beneficio me han generado mis proyectos" (perspectiva personal) sobre la rentabilidad global del conjunto, sin romper la lógica existente de resultado/caja/aportaciones/retiradas/socios, y distinguiendo en el modelo retirada de beneficio de devolución de capital.

**Architecture:** Monorepo con dos repos git independientes: `spendly-backend/` (NestJS + Prisma + PostgreSQL/Supabase) y `spendly/` (Expo/React Native). Todo el cálculo financiero vive en `spendly-backend/src/modules/projects/projects.service.ts`; el frontend solo consume `financials` ya calculado desde `GET /projects` y `GET /projects/:id`. Se añade un campo `isCapitalReturn` a `ProjectManualEntry` y un helper compartido (`attachFinancials`) que calcula la posición del usuario (`myPercentage`, `myProfit`, `myWithdrawnProfit`, `myPending`, ...) una sola vez para listado y detalle.

**Tech Stack:** NestJS 10, Prisma ORM sobre PostgreSQL (Supabase, vía pgbouncer), Jest (backend, patrón: instanciar el service con un `prisma` mockeado a mano, sin `TestingModule`). Frontend: Expo/React Native, TypeScript, React Query, sin infraestructura de tests (se verifica con `npx tsc --noEmit`).

**Spec:** `spendly-backend/docs/superpowers/specs/2026-09-17-proyectos-perspectiva-personal-design.md`

## Global Constraints

- No se puede confundir capital aportado con beneficio en ningún cálculo (regla central de la spec).
- Colores: beneficio positivo verde, negativo rojo; ingresos verde, gastos rojo; aportaciones y retiradas **nunca** se pintan automáticamente como ingreso/gasto (ni verde ni rojo "de más").
- Si un proyecto no tiene socios configurados, se asume `myPercentage = 100`.
- No añadir endpoints de agregado nuevos: la pantalla general sigue sumando en cliente los `financials` por proyecto, igual que hoy.
- La fórmula de caja (`cash = contributions + income - expense - withdrawals`) no cambia.
- `DATABASE_URL` apunta a un Supabase real (no hay base de datos de desarrollo separada). **Cualquier paso que ejecute `prisma migrate deploy` contra esa base requiere confirmación explícita del usuario antes de correrlo** — no es un paso automático más.

---

## Task 1: Migración de schema — campo `isCapitalReturn`

**Files:**
- Modify: `spendly-backend/prisma/schema.prisma:458-483` (modelo `ProjectManualEntry`)
- Create: `spendly-backend/prisma/migrations/20260917120000_project_manual_entry_capital_return/migration.sql`

**Interfaces:**
- Produces: columna `ProjectManualEntry.isCapitalReturn: boolean` (default `false`), consumida por Task 2 (DTO/servicio) y Task 3 (cálculo).

- [ ] **Step 1: Editar el schema de Prisma**

En `spendly-backend/prisma/schema.prisma`, dentro de `model ProjectManualEntry`, añadir el campo justo debajo de `kind`:

```prisma
model ProjectManualEntry {
  id          Int              @id @default(autoincrement())
  projectId   Int
  project     Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)

  kind        ProjectMovementKind
  // Solo relevante cuando kind = withdrawal: true = devolución de capital
  // previamente aportado por el socio, false = retirada de beneficio ya
  // generado. Se ignora para el resto de kinds (siempre queda en false).
  isCapitalReturn Boolean      @default(false)
  title       String
  description String?
  amount      Float
  date        DateTime         @default(now())
  category    String?
  notes       String?

  // Solo se rellena para kind = contribution | withdrawal. SetNull para que
  // el historial financiero de un movimiento sobreviva a que se borre o
  // reconfigure el socio (los socios se reemplazan por completo al editarlos).
  partnerId   Int?
  partner     ProjectPartner?  @relation(fields: [partnerId], references: [id], onDelete: SetNull)

  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt

  @@index([projectId, date])
  @@index([projectId, kind])
  @@index([partnerId])
}
```

- [ ] **Step 2: Escribir la migración SQL a mano**

Crear el directorio `spendly-backend/prisma/migrations/20260917120000_project_manual_entry_capital_return/` con `migration.sql`:

```sql
-- Distingue, dentro de una retirada (kind = withdrawal), si es una retirada
-- de beneficio ya generado o una devolución del capital previamente
-- aportado por el socio. No afecta a income/expense/result ni a la fórmula
-- de caja (que sigue sumando el total de retiradas, ahora desglosado en dos
-- lecturas). Todas las retiradas existentes eran repartos de beneficio
-- (el concepto de devolución de capital no existía hasta ahora), así que el
-- default `false` las clasifica correctamente sin backfill.
ALTER TABLE "ProjectManualEntry" ADD COLUMN "isCapitalReturn" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 3: Regenerar el cliente de Prisma (local, no toca la base de datos)**

Run: `cd spendly-backend && npx prisma generate`
Expected: `Generated Prisma Client` sin errores. Este comando solo lee `schema.prisma` y regenera tipos TypeScript locales — no requiere conexión a la base de datos remota.

- [ ] **Step 4: Aplicar la migración a la base de datos — REQUIERE CONFIRMACIÓN DEL USUARIO**

`DATABASE_URL` apunta a un Supabase real compartido. Antes de ejecutar, preguntar explícitamente al usuario si quiere aplicar esta migración ahora.

Run (solo tras confirmación): `cd spendly-backend && npx prisma migrate deploy`
Expected: `1 migration found... Applied migration 20260917120000_project_manual_entry_capital_return`

- [ ] **Step 5: Commit**

```bash
cd spendly-backend
git add prisma/schema.prisma prisma/migrations/20260917120000_project_manual_entry_capital_return
git commit -m "feat(projects): añade isCapitalReturn a ProjectManualEntry"
```

---

## Task 2: DTO + servicio — persistir `isCapitalReturn` en movimientos manuales

**Files:**
- Modify: `spendly-backend/src/modules/projects/dto/project-manual-entry.dto.ts`
- Modify: `spendly-backend/src/modules/projects/projects.service.ts` (métodos `createManualEntry`, `updateManualEntry`)
- Test: `spendly-backend/src/modules/projects/projects.service.spec.ts` (crear el archivo)

**Interfaces:**
- Consumes: columna `isCapitalReturn` de Task 1.
- Produces: `createManualEntry`/`updateManualEntry` aceptan y persisten `isCapitalReturn?: boolean`, usado por Task 9/10 (frontend) al crear/editar retiradas.

- [ ] **Step 1: Escribir el test que falla**

Crear `spendly-backend/src/modules/projects/projects.service.spec.ts`:

```ts
import { ProjectsService } from './projects.service';

jest.mock('src/common/prisma/prisma.service', () => ({ PrismaService: class {} }), { virtual: true });

describe('ProjectsService — isCapitalReturn en movimientos manuales', () => {
  const prisma = {
    project: { findFirst: jest.fn(async () => ({ id: 1 })) },
    projectPartner: { findFirst: jest.fn(async () => ({ id: 10 })) },
    projectManualEntry: {
      create: jest.fn(async ({ data }: any) => ({ id: 100, ...data })),
    },
  };
  const service = new ProjectsService(prisma as any);

  beforeEach(() => jest.clearAllMocks());

  it('por defecto una retirada se clasifica como beneficio (isCapitalReturn=false)', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 1 });
    prisma.projectPartner.findFirst.mockResolvedValueOnce({ id: 10 });

    const result = await service.createManualEntry(1, 1, {
      kind: 'withdrawal',
      title: 'Reparto de beneficios',
      amount: 100,
      date: '2026-01-01',
      partnerId: 10,
    } as any);

    expect(result.isCapitalReturn).toBe(false);
  });

  it('persiste isCapitalReturn=true para una devolución de capital', async () => {
    prisma.project.findFirst.mockResolvedValueOnce({ id: 1 });
    prisma.projectPartner.findFirst.mockResolvedValueOnce({ id: 10 });

    const result = await service.createManualEntry(1, 1, {
      kind: 'withdrawal',
      title: 'Devolución de capital',
      amount: 500,
      date: '2026-01-01',
      partnerId: 10,
      isCapitalReturn: true,
    } as any);

    expect(result.isCapitalReturn).toBe(true);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: FAIL — `isCapitalReturn` no existe en el DTO ni se persiste (o `result.isCapitalReturn` es `undefined`).

- [ ] **Step 3: Añadir el campo al DTO**

En `spendly-backend/src/modules/projects/dto/project-manual-entry.dto.ts`, añadir `IsBoolean` al import de `class-validator` y el campo a `CreateProjectManualEntryDto` (se hereda en `UpdateProjectManualEntryDto` vía `PartialType`):

```ts
import { IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, MinLength } from 'class-validator';

// ... (ProjectMovementKindDto sin cambios)

export class CreateProjectManualEntryDto {
  @IsEnum(ProjectMovementKindDto)
  kind: ProjectMovementKindDto;

  // Solo relevante cuando kind es withdrawal: true = devolución de capital,
  // false/ausente = retirada de beneficio (default).
  @IsOptional()
  @IsBoolean()
  isCapitalReturn?: boolean;

  @IsString()
  @MinLength(1)
  title: string;

  // ... resto de campos sin cambios
}
```

- [ ] **Step 4: Persistirlo en el servicio**

En `spendly-backend/src/modules/projects/projects.service.ts`, método `createManualEntry` (línea ~373), añadir el campo al `data`:

```ts
return this.prisma.projectManualEntry.create({
  data: {
    projectId,
    kind: dto.kind,
    isCapitalReturn: dto.isCapitalReturn ?? false,
    title: dto.title.trim(),
    description: dto.description?.trim() || null,
    amount: dto.amount,
    date: this.toDate(dto.date, 'date'),
    category: dto.category?.trim() || null,
    notes: dto.notes?.trim() || null,
    partnerId,
  },
});
```

Y en `updateManualEntry` (línea ~409), añadirlo al `data` del `update` (sin `?? false`, para no pisar el valor existente cuando el campo no viene en el PATCH — igual que ya hace `title: dto.title?.trim()`, Prisma ignora los campos `undefined`):

```ts
return this.prisma.projectManualEntry.update({
  where: { id: entryId },
  data: {
    kind: dto.kind,
    isCapitalReturn: dto.isCapitalReturn,
    title: dto.title?.trim(),
    description:
      dto.description !== undefined ? dto.description?.trim() || null : undefined,
    amount: dto.amount,
    date: dto.date ? this.toDate(dto.date, 'date') : undefined,
    category: dto.category !== undefined ? dto.category?.trim() || null : undefined,
    notes: dto.notes !== undefined ? dto.notes?.trim() || null : undefined,
    partnerId,
  },
});
```

- [ ] **Step 5: Ejecutar y verificar que pasa**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
cd spendly-backend
git add src/modules/projects/dto/project-manual-entry.dto.ts src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "feat(projects): acepta y persiste isCapitalReturn en movimientos manuales"
```

---

## Task 3: Desglosar retiradas en `withdrawalsProfit`/`withdrawalsCapital`

**Files:**
- Modify: `spendly-backend/src/modules/projects/projects.service.ts` (`emptyFinancials`, `buildFinancialsMap`)
- Test: `spendly-backend/src/modules/projects/projects.service.spec.ts` (añadir tests)

**Interfaces:**
- Consumes: columna `isCapitalReturn` (Task 1).
- Produces: `financials.withdrawalsProfit`, `financials.withdrawalsCapital` (se mantiene `financials.withdrawals` = suma de ambos, usado por la fórmula de `cash` sin cambios). Consumido por Task 8 (Caja tab) y Task 4 (para `myWithdrawnProfit`, aunque esa parte usa un cálculo por socio aparte, no este total agregado).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `projects.service.spec.ts`:

```ts
describe('ProjectsService — desglose de retiradas por tipo', () => {
  const prisma = {
    project: { findMany: jest.fn(async () => [{ id: 1 }]) },
    transaction: { groupBy: jest.fn(async () => []) },
    projectManualEntry: {
      groupBy: jest.fn(async () => [
        { projectId: 1, kind: 'withdrawal', isCapitalReturn: false, _sum: { amount: 300 } },
        { projectId: 1, kind: 'withdrawal', isCapitalReturn: true, _sum: { amount: 200 } },
      ]),
    },
    projectPartner: { findMany: jest.fn(async () => []) },
  };
  const service = new ProjectsService(prisma as any);

  it('separa retiradas de beneficio y capital, manteniendo el total combinado', async () => {
    const [project] = await service.findAll(1);
    expect(project.financials.withdrawalsProfit).toBe(300);
    expect(project.financials.withdrawalsCapital).toBe(200);
    expect(project.financials.withdrawals).toBe(500);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: FAIL — `withdrawalsProfit`/`withdrawalsCapital` son `undefined` (todavía no existen en `emptyFinancials`).

- [ ] **Step 3: Actualizar `emptyFinancials` y `buildFinancialsMap`**

En `spendly-backend/src/modules/projects/projects.service.ts`:

```ts
private emptyFinancials() {
  return {
    transactionsIncome: 0,
    transactionsExpense: 0,
    manualIncome: 0,
    manualExpense: 0,
    income: 0,
    expense: 0,
    result: 0,
    contributions: 0,
    withdrawals: 0,
    withdrawalsProfit: 0,
    withdrawalsCapital: 0,
    cash: 0,
    myPercentage: 100,
    myProfit: 0,
    myWithdrawnProfit: 0,
    myCapitalContributed: 0,
    myCapitalReturned: 0,
    myPending: 0,
  };
}
```

En `buildFinancialsMap`, cambiar el `groupBy` de `ProjectManualEntry` para incluir `isCapitalReturn` y separar las retiradas:

```ts
private async buildFinancialsMap(userId: number, projectIds: number[]) {
  if (!projectIds.length) return new Map<number, ReturnType<typeof this.emptyFinancials>>();

  const [txGrouped, manualGrouped] = await Promise.all([
    this.prisma.transaction.groupBy({
      by: ['projectId', 'type'],
      where: {
        userId,
        active: true,
        projectId: { in: projectIds },
        type: { in: ['income', 'expense'] },
      },
      _sum: { amount: true },
    }),
    this.prisma.projectManualEntry.groupBy({
      by: ['projectId', 'kind', 'isCapitalReturn'],
      where: {
        projectId: { in: projectIds },
      },
      _sum: { amount: true },
    }),
  ]);

  const map = new Map<number, ReturnType<typeof this.emptyFinancials>>();
  for (const projectId of projectIds) {
    map.set(projectId, this.emptyFinancials());
  }

  for (const row of txGrouped) {
    if (!row.projectId) continue;
    const data = map.get(row.projectId);
    if (!data) continue;
    const value = Number(row._sum.amount || 0);
    if (row.type === 'income') data.transactionsIncome = value;
    if (row.type === 'expense') data.transactionsExpense = value;
  }

  for (const row of manualGrouped) {
    const data = map.get(row.projectId);
    if (!data) continue;
    const value = Number(row._sum.amount || 0);
    if (row.kind === 'income') data.manualIncome = value;
    if (row.kind === 'expense') data.manualExpense = value;
    if (row.kind === 'contribution') data.contributions += value;
    if (row.kind === 'withdrawal' && !row.isCapitalReturn) data.withdrawalsProfit += value;
    if (row.kind === 'withdrawal' && row.isCapitalReturn) data.withdrawalsCapital += value;
  }

  for (const [, data] of map) {
    data.income = data.transactionsIncome + data.manualIncome;
    data.expense = data.transactionsExpense + data.manualExpense;
    data.result = data.income - data.expense;
    data.withdrawals = data.withdrawalsProfit + data.withdrawalsCapital;
    data.cash = data.contributions + data.income - data.expense - data.withdrawals;
  }

  return map;
}
```

Nota: `data.contributions += value` (antes era `=`) porque ahora puede haber más de una fila de `manualGrouped` por `kind` distinta solo por el valor de `isCapitalReturn` (que para `contribution`/`income`/`expense` siempre es `false`, pero Prisma igual las agrupa como filas separadas si hubiera datos con valores mixtos; sumar en vez de asignar es más robusto y no cambia el resultado en el caso normal).

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: PASS (todos los tests hasta ahora)

- [ ] **Step 5: Commit**

```bash
cd spendly-backend
git add src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "feat(projects): desglosa retiradas en beneficio vs capital devuelto"
```

---

## Task 4: "Mi beneficio" — helper compartido `attachFinancials` para listado y detalle

**Files:**
- Modify: `spendly-backend/src/modules/projects/projects.service.ts` (`findAll`, `findOne`, nuevos métodos privados)
- Test: `spendly-backend/src/modules/projects/projects.service.spec.ts` (añadir tests)

**Interfaces:**
- Consumes: `buildFinancialsMap` (Task 3).
- Produces: `financials.myPercentage`, `financials.myProfit`, `financials.myWithdrawnProfit`, `financials.myCapitalContributed`, `financials.myCapitalReturned`, `financials.myPending` en cada proyecto devuelto por `findAll` y `findOne`. Consumido por Task 7 (listado) y Task 8 (bloque "Tu posición" en detalle).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `projects.service.spec.ts`:

```ts
describe('ProjectsService — mi beneficio según mi participación', () => {
  const prisma = {
    project: { findMany: jest.fn(async () => [{ id: 1 }, { id: 2 }]) },
    transaction: {
      groupBy: jest.fn(async () => [
        { projectId: 1, type: 'income', _sum: { amount: 2931.86 } },
        { projectId: 1, type: 'expense', _sum: { amount: 742.20 } },
      ]),
    },
    projectManualEntry: {
      groupBy: jest.fn(async ({ by }: any) => {
        if (by.includes('partnerId')) {
          return [{ partnerId: 50, kind: 'withdrawal', isCapitalReturn: false, _sum: { amount: 400 } }];
        }
        return [];
      }),
    },
    projectPartner: {
      findMany: jest.fn(async ({ where }: any) =>
        where.isMe ? [{ id: 50, projectId: 1, percentage: 50 }] : [{ id: 50, projectId: 1 }],
      ),
    },
  };
  const service = new ProjectsService(prisma as any);

  it('calcula mi beneficio como resultado del proyecto * mi porcentaje', async () => {
    const projects = await service.findAll(1);
    const projectA = projects.find((p) => p.id === 1)!;

    expect(projectA.financials.result).toBeCloseTo(2189.66, 2);
    expect(projectA.financials.myPercentage).toBe(50);
    expect(projectA.financials.myProfit).toBeCloseTo(1094.83, 2);
    expect(projectA.financials.myWithdrawnProfit).toBe(400);
    expect(projectA.financials.myPending).toBeCloseTo(694.83, 2);
  });

  it('asume 100% cuando el proyecto no tiene ningún socio configurado', async () => {
    const projects = await service.findAll(1);
    const projectB = projects.find((p) => p.id === 2)!;

    expect(projectB.financials.myPercentage).toBe(100);
    expect(projectB.financials.myProfit).toBe(0);
    expect(projectB.financials.myWithdrawnProfit).toBe(0);
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: FAIL — `myPercentage`/`myProfit`/etc. quedan en los valores por defecto de `emptyFinancials` (100/0/0/0) para el proyecto 1, que sí tiene socio al 50%.

- [ ] **Step 3: Añadir los helpers y `attachFinancials`**

En `spendly-backend/src/modules/projects/projects.service.ts`, añadir estos métodos privados (junto a `buildFinancialsMap`):

```ts
// Socio marcado isMe por proyecto, con su porcentaje. Si el proyecto no
// tiene ningún socio configurado, se asume que el usuario es dueño al 100%
// (partnerId=-1 no existe nunca, así que buildPartnerLedgerMap devuelve
// ceros para él, que es justo lo que corresponde: sin socios no puede haber
// aportaciones/retiradas registradas).
private async buildMyPartnerByProject(projectIds: number[]) {
  const map = new Map<number, { id: number; percentage: number }>();
  for (const projectId of projectIds) map.set(projectId, { id: -1, percentage: 100 });

  if (!projectIds.length) return map;

  const partners = await this.prisma.projectPartner.findMany({
    where: { projectId: { in: projectIds }, isMe: true },
    select: { id: true, projectId: true, percentage: true },
  });

  for (const partner of partners) {
    map.set(partner.projectId, { id: partner.id, percentage: partner.percentage });
  }

  return map;
}

// Aportado/retirado-de-beneficio/capital-devuelto por socio (todos los
// socios de los proyectos dados, no solo "yo"). Lo reutilizan tanto el
// cálculo de "mi beneficio" (aquí, filtrando por el socio isMe) como el
// desglose por socio del detalle (Task 5).
private async buildPartnerLedgerMap(projectIds: number[]) {
  const empty = () => ({ contributed: 0, withdrawnProfit: 0, capitalReturned: 0 });
  const map = new Map<number, ReturnType<typeof empty>>();
  if (!projectIds.length) return map;

  const partners = await this.prisma.projectPartner.findMany({
    where: { projectId: { in: projectIds } },
    select: { id: true },
  });
  if (!partners.length) return map;

  for (const partner of partners) map.set(partner.id, empty());

  const partnerIds = partners.map((p) => p.id);
  const rows = await this.prisma.projectManualEntry.groupBy({
    by: ['partnerId', 'kind', 'isCapitalReturn'],
    where: { partnerId: { in: partnerIds } },
    _sum: { amount: true },
  });

  for (const row of rows) {
    if (row.partnerId == null) continue;
    const entry = map.get(row.partnerId);
    if (!entry) continue;
    const value = Number(row._sum.amount || 0);
    if (row.kind === 'contribution') entry.contributed += value;
    if (row.kind === 'withdrawal' && !row.isCapitalReturn) entry.withdrawnProfit += value;
    if (row.kind === 'withdrawal' && row.isCapitalReturn) entry.capitalReturned += value;
  }

  return map;
}

// Punto único donde se combina el resultado del proyecto (buildFinancialsMap)
// con la posición personal del usuario (su % y su ledger de aportaciones /
// retiradas). Lo usan findAll y findOne, así el listado y el detalle nunca
// pueden desincronizarse en cómo calculan "mi beneficio".
private async attachFinancials<T extends { id: number }>(userId: number, projects: T[]) {
  const projectIds = projects.map((p) => p.id);
  const [financialsMap, myPartnerMap, ledgerMap] = await Promise.all([
    this.buildFinancialsMap(userId, projectIds),
    this.buildMyPartnerByProject(projectIds),
    this.buildPartnerLedgerMap(projectIds),
  ]);

  return projects.map((project) => {
    const financials = financialsMap.get(project.id)!;
    const myPartner = myPartnerMap.get(project.id)!;
    const ledger = ledgerMap.get(myPartner.id) ?? { contributed: 0, withdrawnProfit: 0, capitalReturned: 0 };
    const myProfit = financials.result * (myPartner.percentage / 100);

    return {
      ...project,
      financials: {
        ...financials,
        myPercentage: myPartner.percentage,
        myProfit,
        myWithdrawnProfit: ledger.withdrawnProfit,
        myCapitalContributed: ledger.contributed,
        myCapitalReturned: ledger.capitalReturned,
        myPending: myProfit - ledger.withdrawnProfit,
      },
    };
  });
}
```

Ahora simplificar `findAll` para usar el helper:

```ts
async findAll(userId: number) {
  const projects = await this.prisma.project.findMany({
    where: { userId },
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });

  return this.attachFinancials(userId, projects);
}
```

Y en `findOne`, sustituir el bloque que hoy calcula `financials` a mano por el helper (dejando intacta, de momento, la parte de `partners`/`partnerAgg` — eso lo toca la Task 5):

```ts
async findOne(userId: number, projectId: number) {
  const project = await this.prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      transactions: {
        where: { active: true },
        include: {
          category: true,
          subcategory: true,
          wallet: true,
          fromWallet: true,
          toWallet: true,
        },
        orderBy: { date: 'desc' },
      },
      manualEntries: {
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      },
      partners: {
        orderBy: [{ isMe: 'desc' }, { name: 'asc' }],
      },
    },
  });

  if (!project) {
    throw new NotFoundException('Proyecto no encontrado');
  }

  const [withFinancials, partnerAgg] = await Promise.all([
    this.attachFinancials(userId, [project]),
    this.prisma.projectManualEntry.groupBy({
      by: ['partnerId', 'kind'],
      where: {
        projectId,
        partnerId: { not: null },
        kind: { in: ['contribution', 'withdrawal'] },
      },
      _sum: { amount: true },
    }),
  ]);

  const { financials } = withFinancials[0];

  const partners = project.partners.map((partner) => {
    const contributed = partnerAgg.find(
      (row) => row.partnerId === partner.id && row.kind === 'contribution',
    );
    const withdrawn = partnerAgg.find(
      (row) => row.partnerId === partner.id && row.kind === 'withdrawal',
    );
    return {
      ...partner,
      contributed: Number(contributed?._sum.amount || 0),
      withdrawn: Number(withdrawn?._sum.amount || 0),
    };
  });

  return {
    ...project,
    partners,
    financials,
  };
}
```

(La parte de `partnerAgg`/`partners` se queda tal cual por ahora a propósito — la Task 5 la sustituye por `buildPartnerLedgerMap` para desglosar `withdrawn` en `withdrawnProfit`/`capitalReturned`. Tocarla aquí ya habría hecho este paso demasiado grande para revisar de una vez.)

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: PASS (todos los tests)

- [ ] **Step 5: Commit**

```bash
cd spendly-backend
git add src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "feat(projects): calcula mi beneficio/retirado/pendiente compartido entre listado y detalle"
```

---

## Task 5: Detalle — desglosar `withdrawn` por socio en `withdrawnProfit`/`capitalReturned`

**Files:**
- Modify: `spendly-backend/src/modules/projects/projects.service.ts` (`findOne`)
- Test: `spendly-backend/src/modules/projects/projects.service.spec.ts` (añadir test)

**Interfaces:**
- Consumes: `buildPartnerLedgerMap` (Task 4).
- Produces: cada elemento de `partners` en la respuesta de `findOne` pasa de `{ contributed, withdrawn }` a `{ contributed, withdrawnProfit, capitalReturned }`. Consumido por Task 10 (sección Socios en el frontend).

- [ ] **Step 1: Escribir el test que falla**

Añadir a `projects.service.spec.ts`:

```ts
describe('ProjectsService — desglose de retiradas por socio en el detalle', () => {
  const prisma = {
    project: {
      findFirst: jest.fn(async () => ({
        id: 1,
        transactions: [],
        manualEntries: [],
        partners: [{ id: 50, name: 'Yo', percentage: 100, isMe: true }],
      })),
    },
    transaction: { groupBy: jest.fn(async () => []) },
    projectManualEntry: {
      groupBy: jest.fn(async () => [
        { partnerId: 50, kind: 'contribution', isCapitalReturn: false, _sum: { amount: 500 } },
        { partnerId: 50, kind: 'withdrawal', isCapitalReturn: false, _sum: { amount: 300 } },
        { partnerId: 50, kind: 'withdrawal', isCapitalReturn: true, _sum: { amount: 500 } },
      ]),
    },
    projectPartner: {
      findMany: jest.fn(async ({ where }: any) =>
        where.isMe ? [{ id: 50, projectId: 1, percentage: 100 }] : [{ id: 50 }],
      ),
    },
  };
  const service = new ProjectsService(prisma as any);

  it('separa retirado de beneficio y capital devuelto para cada socio', async () => {
    const detail = await service.findOne(1, 1);
    const [partner] = detail.partners;

    expect(partner.contributed).toBe(500);
    expect(partner.withdrawnProfit).toBe(300);
    expect(partner.capitalReturned).toBe(500);
    expect((partner as any).withdrawn).toBeUndefined();
  });
});
```

- [ ] **Step 2: Ejecutar y verificar que falla**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: FAIL — el objeto `partner` todavía trae `withdrawn` (mezclando beneficio y capital) en vez de `withdrawnProfit`/`capitalReturned`.

- [ ] **Step 3: Reemplazar `partnerAgg` por `buildPartnerLedgerMap` en `findOne`**

En `spendly-backend/src/modules/projects/projects.service.ts`, sustituir el bloque de `partnerAgg`/`partners` de `findOne` (el que quedó de la Task 4) por:

```ts
const [withFinancials, ledgerMap] = await Promise.all([
  this.attachFinancials(userId, [project]),
  this.buildPartnerLedgerMap([projectId]),
]);

const { financials } = withFinancials[0];

const partners = project.partners.map((partner) => {
  const ledger = ledgerMap.get(partner.id) ?? { contributed: 0, withdrawnProfit: 0, capitalReturned: 0 };
  return {
    ...partner,
    contributed: ledger.contributed,
    withdrawnProfit: ledger.withdrawnProfit,
    capitalReturned: ledger.capitalReturned,
  };
});

return {
  ...project,
  partners,
  financials,
};
```

Esto sustituye por completo el `Promise.all` y las variables `partnerAgg`/`partners` que había quedado de la Task 4 dentro de `findOne` — no queda ninguna referencia a `partnerAgg`.

- [ ] **Step 4: Ejecutar y verificar que pasa**

Run: `cd spendly-backend && npx jest projects.service.spec.ts`
Expected: PASS (todos los tests)

- [ ] **Step 5: Commit**

```bash
cd spendly-backend
git add src/modules/projects/projects.service.ts src/modules/projects/projects.service.spec.ts
git commit -m "feat(projects): desglosa retirado de beneficio vs capital devuelto por socio"
```

---

## Task 6: Frontend — tipos compartidos `src/types/project.ts`

**Files:**
- Create: `spendly/src/types/project.ts`

**Interfaces:**
- Produces: `ProjectStatus`, `ProjectMovementKind`, `ProjectFinancials`, `ProjectPartner`, `ProjectListItem`, `ProjectDetail`, `ProjectManualEntry`, `ProjectTransaction`. Consumidos por Task 7 y Task 8-11.

- [ ] **Step 1: Crear el archivo de tipos**

```ts
// spendly/src/types/project.ts
// Tipos compartidos del módulo de Proyectos. Antes vivían duplicados e
// inconsistentes dentro de ProjectsScreen/ProjectDetailScreen/ProjectFormScreen;
// se centralizan aquí las partes que ambas pantallas necesitan (financials,
// socios, status) para que no puedan desincronizarse.

export type ProjectStatus = 'idea' | 'active' | 'paused' | 'completed' | 'cancelled';

export type ProjectMovementKind = 'income' | 'expense' | 'contribution' | 'withdrawal';

export interface ProjectFinancials {
  transactionsIncome: number;
  transactionsExpense: number;
  manualIncome: number;
  manualExpense: number;
  income: number;
  expense: number;
  result: number;
  contributions: number;
  withdrawals: number;
  withdrawalsProfit: number;
  withdrawalsCapital: number;
  cash: number;
  myPercentage: number;
  myProfit: number;
  myWithdrawnProfit: number;
  myCapitalContributed: number;
  myCapitalReturned: number;
  myPending: number;
}

export interface ProjectPartner {
  id: number;
  name: string;
  percentage: number;
  isMe: boolean;
  contributed: number;
  withdrawnProfit: number;
  capitalReturned: number;
}

export interface ProjectTransaction {
  id: number;
  type: 'income' | 'expense' | 'transfer';
  amount: number;
  description?: string | null;
  date?: string | null;
  projectId?: number | null;
}

export interface ProjectManualEntry {
  id: number;
  kind: ProjectMovementKind;
  isCapitalReturn: boolean;
  title: string;
  description?: string | null;
  amount: number;
  date: string;
  category?: string | null;
  notes?: string | null;
  partnerId?: number | null;
}

export interface ProjectListItem {
  id: number;
  name: string;
  description?: string | null;
  type?: string | null;
  status: ProjectStatus;
  startDate: string;
  endDate?: string | null;
  notes?: string | null;
  financials: ProjectFinancials;
}

export interface ProjectDetail extends ProjectListItem {
  transactions: ProjectTransaction[];
  manualEntries: ProjectManualEntry[];
  partners: ProjectPartner[];
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd spendly && npx tsc --noEmit`
Expected: sin nuevos errores relacionados con `src/types/project.ts` (el archivo aún no se usa en ningún sitio, así que no debería cambiar el resultado del typecheck respecto a antes de este paso).

- [ ] **Step 3: Commit**

```bash
cd spendly
git add src/types/project.ts
git commit -m "feat(projects): centraliza los tipos de Project en src/types"
```

---

## Task 7: `ProjectsScreen` — perspectiva personal en la pantalla general

**Files:**
- Modify: `spendly/src/screens/Mobile/finances/projects/ProjectsScreen.tsx`

**Interfaces:**
- Consumes: `ProjectListItem`, `ProjectFinancials` de `src/types/project.ts` (Task 6); `financials.myProfit`/`myWithdrawnProfit`/`myPercentage` del backend (Task 4).

- [ ] **Step 1: Sustituir el tipo local por el compartido**

En `spendly/src/screens/Mobile/finances/projects/ProjectsScreen.tsx`, quitar el tipo `ProjectItem` inline (líneas 23-37) e importar el tipo compartido:

```ts
import { ProjectListItem, ProjectStatus } from '../../../../types/project';
```

y usar `ProjectListItem` en vez de `ProjectItem` en `const projects: ProjectItem[] = ...` → `const projects: ProjectListItem[] = ...`. El tipo local `ProjectFilter` se queda igual (es propio de esta pantalla, no del dominio).

- [ ] **Step 2: Cambiar los totales de la pantalla**

Sustituir el `useMemo` de `totals` (líneas 77-87):

```ts
const totals = useMemo(() => {
  return projects.reduce(
    (acc, project) => {
      acc.myProfit += Number(project.financials?.myProfit || 0);
      acc.myWithdrawnProfit += Number(project.financials?.myWithdrawnProfit || 0);
      return acc;
    },
    { myProfit: 0, myWithdrawnProfit: 0 },
  );
}, [projects]);

const myPending = totals.myProfit - totals.myWithdrawnProfit;
```

- [ ] **Step 3: Cambiar el hero y el StatsRow de cabecera**

Sustituir el bloque del hero (líneas 112-126):

```tsx
<View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
  <HeroBalanceCard
    label="MI BENEFICIO"
    value={formatCurrency(totals.myProfit)}
    style={{ marginBottom: 8 }}
  />

  <StatsRow
    items={[
      {
        key: 'generado',
        label: 'GENERADO',
        value: formatCurrency(totals.myProfit),
        color: totals.myProfit >= 0 ? colors.success : colors.danger,
      },
      { key: 'retirado', label: 'RETIRADO', value: formatCurrency(totals.myWithdrawnProfit) },
      {
        key: 'pendiente',
        label: 'PENDIENTE',
        value: formatCurrency(myPending),
        color: myPending >= 0 ? colors.success : colors.danger,
      },
    ]}
  />
</View>
```

Nota: el item `RETIRADO` no recibe `color` — se queda con el color por defecto de `StatsRow` (`#0F172A`, neutro), porque una retirada de beneficio no es un gasto y no debe pintarse en rojo.

- [ ] **Step 4: Cambiar la fila de cada proyecto**

Dentro de `filteredProjects.map((project) => { ... })` (líneas 151-208), sustituir el cálculo de `result`/`resultColor` y el bloque de la derecha:

```tsx
const myProfit = Number(project.financials?.myProfit || 0);
const myProfitColor = myProfit >= 0 ? colors.success : colors.danger;
const projectResult = Number(project.financials?.result || 0);
const resultColor = projectResult >= 0 ? colors.success : colors.danger;
const badgeColors = STATUS_COLORS[project.status];
const hasActivity =
  Number(project.financials?.income || 0) !== 0 ||
  Number(project.financials?.expense || 0) !== 0 ||
  Number(project.financials?.myPercentage || 100) !== 100;
```

(`hasActivity` en `false` significa: proyecto sin ningún movimiento y sin socios configurados más allá del 100% por defecto — típicamente una Idea recién creada.)

Cabecera de la fila (nombre + importe principal), sustituyendo líneas 173-183:

```tsx
<View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
  <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: '#0F172A' }} numberOfLines={1}>
    {project.name}
  </Text>
  {hasActivity && (
    <Text style={{ fontSize: 15, fontWeight: '700', color: myProfitColor, marginLeft: 8 }}>
      {formatCurrency(myProfit)}
    </Text>
  )}
</View>
```

Fila inferior (badge + resultado del proyecto), sustituyendo líneas 185-205:

```tsx
<View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
  <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: badgeColors.bg }}>
    <Text style={{ fontSize: 11, fontWeight: '600', color: badgeColors.text }}>
      {STATUS_LABELS[project.status]}
      {hasActivity ? ` · ${project.financials.myPercentage}%` : ''}
    </Text>
  </View>
  {hasActivity ? (
    <Text style={{ fontSize: 11, fontWeight: '600', color: resultColor }}>
      Resultado proyecto: {formatCurrency(projectResult)}
    </Text>
  ) : (
    <Text style={{ fontSize: 11, color: '#94A3B8' }}>Sin movimientos todavía</Text>
  )}
</View>
```

Esto elimina el uso de `Ionicons` (`arrow-up`/`arrow-down`) en esta pantalla — si `Ionicons` deja de usarse en algún otro sitio del archivo, dejar el import (comprobar con el `Step 5` de typecheck; si sobra, `tsc` no lo marca como error, así que no hace falta tocarlo salvo que el linter del proyecto lo señale).

- [ ] **Step 5: Verificar que compila**

Run: `cd spendly && npx tsc --noEmit`
Expected: sin errores nuevos en `ProjectsScreen.tsx`.

- [ ] **Step 6: Commit**

```bash
cd spendly
git add src/screens/Mobile/finances/projects/ProjectsScreen.tsx
git commit -m "feat(projects): la pantalla general prioriza mi beneficio sobre la rentabilidad global"
```

---

## Task 8: `ProjectDetailScreen` — bloque compacto "Tu posición"

**Files:**
- Modify: `spendly/src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx`

**Interfaces:**
- Consumes: `ProjectDetail`, `ProjectFinancials` de `src/types/project.ts` (Task 6); `financials.myPercentage`/`myProfit`/`myWithdrawnProfit`/`myPending` (Task 4).

- [ ] **Step 1: Sustituir los tipos inline por los compartidos**

Quitar de `ProjectDetailScreen.tsx` los tipos `ProjectStatus`, `MovementKind`, `ProjectTransaction`, `ProjectManualEntry`, `ProjectPartner`, `ProjectDetail` (líneas 32-107) e importar:

```ts
import {
  ProjectStatus,
  ProjectMovementKind as MovementKind,
  ProjectTransaction,
  ProjectManualEntry,
  ProjectPartner,
  ProjectDetail,
} from '../../../../types/project';
```

(Se mantiene el alias `MovementKind` para no tener que renombrar todos los usos existentes en este archivo.)

- [ ] **Step 2: Añadir el bloque "Tu posición" tras la cabecera**

En el JSX, justo después del `StatsRow` de Ingresos/Gastos de la cabecera (tras la línea 834, tras cerrar el `<View style={{ paddingHorizontal: 20 }}>`), añadir:

```tsx
const hasActivity =
  Number(project.financials.income || 0) !== 0 ||
  Number(project.financials.expense || 0) !== 0 ||
  Number(project.financials.myPercentage || 100) !== 100;

const myProfit = Number(project.financials.myProfit || 0);
const myPending = Number(project.financials.myPending || 0);
```

(justo antes del `return (` del componente, junto a las otras constantes derivadas como `result`/`distributable`)

y en el JSX, dentro de `<View style={{ paddingHorizontal: 20 }}>`, tras el `StatsRow` de Ingresos/Gastos:

```tsx
{hasActivity && (
  <View
    style={{
      backgroundColor: '#FFFFFF',
      borderWidth: 1,
      borderColor: '#E2E8F0',
      borderRadius: 16,
      paddingHorizontal: 14,
      paddingVertical: 12,
      marginTop: 8,
    }}
  >
    <Text style={{ fontSize: 11, fontWeight: '900', color: '#64748B', letterSpacing: 0.55, marginBottom: 8 }}>
      TU POSICIÓN
    </Text>
    <StatsRow
      items={[
        { key: 'participacion', label: 'TU PARTICIPACIÓN', value: `${project.financials.myPercentage}%` },
        {
          key: 'mi-beneficio',
          label: 'TU BENEFICIO',
          value: formatCurrency(myProfit),
          color: myProfit >= 0 ? colors.success : colors.danger,
        },
      ]}
    />
    <View style={{ marginTop: 10 }}>
      <StatsRow
        items={[
          { key: 'retirado', label: 'RETIRADO', value: formatCurrency(project.financials.myWithdrawnProfit) },
          {
            key: 'pendiente',
            label: 'PENDIENTE',
            value: formatCurrency(myPending),
            color: myPending >= 0 ? colors.success : colors.danger,
          },
        ]}
      />
    </View>
  </View>
)}
```

- [ ] **Step 3: Verificar que compila**

Run: `cd spendly && npx tsc --noEmit`
Expected: sin errores nuevos en `ProjectDetailScreen.tsx`.

- [ ] **Step 4: Commit**

```bash
cd spendly
git add src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx
git commit -m "feat(projects): añade el bloque compacto Tu posición al detalle del proyecto"
```

---

## Task 9: Tab Caja — desglosar retiradas y corregir colores

**Files:**
- Modify: `spendly/src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx` (tab `cash`)

**Interfaces:**
- Consumes: `financials.withdrawalsProfit`/`withdrawalsCapital` (Task 3).

- [ ] **Step 1: Sustituir la lista de desglose de caja**

En el tab `cash` (líneas 997-1023), sustituir el array de filas:

```tsx
<View style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
  {[
    { label: 'Aportaciones', value: project.financials.contributions, sign: '+' as const },
    { label: 'Ingresos', value: project.financials.income, sign: '+' as const, tone: 'signal' as const },
    { label: 'Gastos', value: project.financials.expense, sign: '-' as const, tone: 'signal' as const },
    { label: 'Retiradas de beneficio', value: project.financials.withdrawalsProfit, sign: '-' as const },
    ...(project.financials.withdrawalsCapital > 0
      ? [{ label: 'Capital devuelto', value: project.financials.withdrawalsCapital, sign: '-' as const }]
      : []),
  ].map((row, index, arr) => (
    <View
      key={row.label}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        minHeight: 43,
        borderBottomWidth: index < arr.length - 1 ? 1 : 0,
        borderBottomColor: '#E8EDF4',
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: '#64748B' }}>{row.label}</Text>
      <Text
        style={{
          fontSize: 13,
          fontWeight: '800',
          color: row.tone === 'signal' ? (row.sign === '+' ? colors.success : colors.danger) : '#334155',
        }}
      >
        {row.sign}{formatCurrency(row.value)}
      </Text>
    </View>
  ))}
</View>
```

Esto deja verde/rojo solo para Ingresos/Gastos (marcados `tone: 'signal'`); Aportaciones, Retiradas de beneficio y Capital devuelto pasan a un color neutro (`#334155`) — ya no se pintan como si fueran ingreso/gasto.

- [ ] **Step 2: Verificar que compila**

Run: `cd spendly && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
cd spendly
git add src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx
git commit -m "fix(projects): retiradas y aportaciones ya no se pintan como ingreso/gasto"
```

---

## Task 10: Sección Socios — mostrar capital devuelto por socio

**Files:**
- Modify: `spendly/src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx` (bloque SOCIOS del tab `cash`)

**Interfaces:**
- Consumes: `ProjectPartner.withdrawnProfit`/`capitalReturned` (Task 5).

- [ ] **Step 1: Actualizar el cálculo de `distributable` y el texto de cada socio**

`distributable` (línea 796) usaba `project.financials.withdrawals` — sigue siendo válido (es la suma de ambos tipos de retirada, y `distributable` representa "beneficio del proyecto entero sin repartir", no una cifra personal), así que no cambia.

En el `map` de socios (líneas 1052-1080), sustituir la línea de texto secundario:

```tsx
<Text style={{ fontSize: 11, color: '#94A3B8' }}>
  Aportado {formatCurrency(partner.contributed)} · Retirado {formatCurrency(partner.withdrawnProfit)}
  {partner.capitalReturned > 0 ? ` · Devuelto ${formatCurrency(partner.capitalReturned)}` : ''}
</Text>
```

(Antes usaba `partner.withdrawn`, que ya no existe en el tipo — este cambio es obligatorio para que compile, no solo cosmético.)

- [ ] **Step 2: Verificar que compila**

Run: `cd spendly && npx tsc --noEmit`
Expected: sin errores. Si quedara alguna otra referencia a `partner.withdrawn` en el archivo, `tsc` la señalará — corregirla del mismo modo (usar `withdrawnProfit`).

- [ ] **Step 3: Commit**

```bash
cd spendly
git add src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx
git commit -m "feat(projects): muestra el capital devuelto por socio cuando aplica"
```

---

## Task 11: Modal de movimiento manual — selector beneficio/capital

**Files:**
- Modify: `spendly/src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx` (`ManualForm`, `defaultManualForm`, `openManualEdit`, `saveManualEntry`, modal de movimiento manual)

**Interfaces:**
- Produces: el payload de `POST/PATCH .../manual-entries` incluye `isCapitalReturn` cuando `kind === 'withdrawal'`. Consumido por el backend de Task 2.

- [ ] **Step 1: Añadir el campo al estado del formulario**

En el tipo `ManualForm` (línea 109-118), añadir:

```ts
type ManualForm = {
  kind: MovementKind;
  isCapitalReturn: boolean;
  title: string;
  description: string;
  amount: string;
  date: Date;
  category: string;
  notes: string;
  partnerId: number | null;
};
```

En `defaultManualForm()` (línea 196-207), añadir `isCapitalReturn: false,`.

En `openManualEdit` (línea 357-370), añadir `isCapitalReturn: entry.isCapitalReturn,` al objeto que se pasa a `setManualForm`.

- [ ] **Step 2: Incluirlo en el payload al guardar**

En `saveManualEntry` (línea 399-434), añadir al `payload`:

```ts
const payload = {
  kind: manualForm.kind,
  isCapitalReturn: manualForm.kind === 'withdrawal' ? manualForm.isCapitalReturn : false,
  title: manualForm.title.trim(),
  description: manualForm.description.trim() || null,
  amount: Number(String(manualForm.amount).replace(',', '.')),
  date: manualForm.date.toISOString(),
  category: manualForm.category.trim() || null,
  notes: manualForm.notes.trim() || null,
  partnerId: needsPartner(manualForm.kind) ? manualForm.partnerId : null,
};
```

- [ ] **Step 3: Añadir el selector al modal**

En el modal de movimiento manual, justo después del bloque `{needsPartner(manualForm.kind) && (...)}` (tras la línea 1248), añadir:

```tsx
{manualForm.kind === 'withdrawal' && (
  <View style={{ marginBottom: 8 }}>
    <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 6 }}>Tipo de retirada</Text>
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {[
        { value: false, label: 'Retirada de beneficio' },
        { value: true, label: 'Devolución de capital' },
      ].map((option) => {
        const active = manualForm.isCapitalReturn === option.value;
        return (
          <TouchableOpacity
            key={String(option.value)}
            onPress={() => setManualForm((prev) => ({ ...prev, isCapitalReturn: option.value }))}
            style={{
              flex: 1,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: active ? colors.primary : '#D1D5DB',
              backgroundColor: active ? colors.primary : 'white',
              alignItems: 'center',
            }}
          >
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: active ? 'white' : '#64748B' }}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  </View>
)}
```

- [ ] **Step 4: Verificar que compila**

Run: `cd spendly && npx tsc --noEmit`
Expected: sin errores nuevos.

- [ ] **Step 5: Commit**

```bash
cd spendly
git add src/screens/Mobile/finances/projects/ProjectDetailScreen.tsx
git commit -m "feat(projects): permite marcar una retirada como devolución de capital"
```

---

## Self-Review (hecho al escribir este plan)

- **Cobertura de la spec:** hero "MI BENEFICIO" (Task 7) · GENERADO/RETIRADO/PENDIENTE (Task 7) · fila de proyecto con mi beneficio + % (Task 7) · cálculo resultado×participación (Task 4) · detalle con resumen de proyecto intacto + "Tu posición" (Task 8) · separación aportación/retirada de beneficio/capital devuelto (Task 1-3, 9) · colores (Task 7, 9) · filtros Activos/Ideas/Todos sin tocar (ninguna task los modifica) · estado neutro para ideas sin actividad (Task 7, 8). Todo cubierto.
- **Placeholders:** ninguno — cada step trae el código completo, no descripciones vagas.
- **Consistencia de tipos:** `ProjectPartner.withdrawn` (nombre viejo) desaparece por completo a partir de la Task 5/6 — Task 10 lo confirma explícitamente. `MovementKind` se mantiene como alias de `ProjectMovementKind` para no tocar cada uso en `ProjectDetailScreen.tsx`. Los nombres de campos de `financials` (`myProfit`, `myWithdrawnProfit`, `myPending`, `myPercentage`, `myCapitalContributed`, `myCapitalReturned`, `withdrawalsProfit`, `withdrawalsCapital`) son idénticos entre backend (Tasks 3-5), tipos compartidos (Task 6) y su uso en frontend (Tasks 7-9).
