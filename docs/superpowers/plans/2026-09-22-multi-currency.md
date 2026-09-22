# Finexa Multi-Currency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Nota de este proyecto:** el usuario ha pedido previamente implementar directo (Write/Edit/Bash) tras aprobar el plan, sin la ceremonia de subagent-driven-development. Esta sesión ejecuta el plan inline, tarea a tarea, con los mismos checkpoints de revisión.

**Goal:** Convertir Finexa en multi-currency: cada Wallet/Transaction/Budget/Trip/Debt puede tener su propia moneda, con una moneda base por usuario para consolidar patrimonio y estadísticas, sin perder ni convertir destructivamente ningún importe original.

**Architecture:** Un módulo `currency/` nuevo en el backend (`CurrencyService` + `ExchangeRateProvider` + `FrankfurterProvider` + cache `ExchangeRate` + cron diario) es la única fuente de conversión. Los módulos existentes (`transactions`, `dashboard`, `budgets`, `trips`, `debts`, `investments`) lo consumen sin implementar conversión propia. El frontend nunca convierte: llama a endpoints ya convertidos o usa `formatCurrency` solo para presentación.

**Tech Stack:** NestJS 10, Prisma (PostgreSQL), `axios` (ya usado en `fmp.service.ts` para HTTP saliente), Jest, React Native/Expo, `Intl.NumberFormat`, Vitest (frontend).

**Spec:** [docs/superpowers/specs/2026-09-22-multi-currency-design.md](../specs/2026-09-22-multi-currency-design.md)

## Global Constraints

- `User.currency` (ya existe, default `"EUR"`) es la moneda base — no se crea `User.baseCurrency`.
- Los `Float` de dinero existentes (`Wallet.balance`, `Transaction.amount`, `Debt.totalAmount/payed/remainingAmount`, `InvestmentOperation.amount`, `Trip.cost/budget`, límites de `Budget`) **no se tocan** en esta entrega. Los campos nuevos de FX son `Decimal`.
- El pivote de tipos de cambio es siempre `EUR`. No se guarda ninguna fila cruzada (p.ej. CHF→USD): se calcula en memoria.
- `Transaction.baseAmount` se calcula **una sola vez, al crear la transacción**, con el tipo histórico de esa fecha, y nunca se recalcula después.
- El saldo de `Wallet` y el patrimonio neto siempre usan el tipo **actual** (`getCurrentRate`), nunca el histórico.
- Ningún componente React hace aritmética de conversión de divisas. Toda conversión pasa por `CurrencyService` (backend) o llega ya convertida desde un endpoint.
- Cada `db push` de Prisma es aditivo (columnas nuevas con default/nullable) — cero pérdida de datos, confirmado en el diseño.
- Backend en `C:\PROYECTOS\Spendly_fronted_dev\spendly-backend`, frontend en `C:\PROYECTOS\Spendly_fronted_dev\spendly`. Son dos repos git independientes (`Finexa_Backendd`, `Finexa_Frontend`).

---

## Fase 1 — Schema + migración

### Task 1: Añadir campos y modelo ExchangeRate al schema

**Files:**
- Modify: `spendly-backend/prisma/schema.prisma`

**Interfaces:**
- Produces: los campos `Transaction.currency/baseAmount/exchangeRate/accountAmount/accountCurrency`, `Budget.currency`, `Trip.currency`, `Debt.currency`, y el modelo `ExchangeRate`, que consumen todas las tareas siguientes.

- [ ] **Step 1: Añadir los campos al modelo `Transaction`** (en `schema.prisma`, dentro del bloque `model Transaction { ... }`, justo debajo de `amount Float`):

```prisma
  amount        Float
  currency      String       @default("EUR")
  baseAmount    Decimal?     @db.Decimal(14, 4)
  exchangeRate  Decimal?     @db.Decimal(18, 8)
  accountAmount   Decimal?   @db.Decimal(14, 4)
  accountCurrency String?
  description   String?
```

- [ ] **Step 2: Añadir `currency` a `Budget`** (dentro de `model Budget { ... }`, justo debajo de `totalLimit Float?`):

```prisma
  totalLimit Float?
  currency   String @default("EUR")
```

- [ ] **Step 3: Añadir `currency` a `Trip`** (dentro de `model Trip { ... }`, justo debajo de `budget Float?`):

```prisma
  cost        Float      @default(0)
  budget      Float?
  currency    String     @default("EUR")
```

- [ ] **Step 4: Añadir `currency` a `Debt`** (dentro de `model Debt { ... }`, justo debajo de `remainingAmount Float`):

```prisma
  totalAmount      Float
  payed            Float?         @default(0)
  remainingAmount  Float
  currency         String         @default("EUR")
```

- [ ] **Step 5: Añadir el modelo `ExchangeRate`** al final del archivo:

```prisma
//////////////////////////////////////////////////////////////
// TIPOS DE CAMBIO (cache)
//////////////////////////////////////////////////////////////

model ExchangeRate {
  id            Int      @id @default(autoincrement())
  date          DateTime // normalizada a 00:00 UTC — es una fecha, no un instante
  baseCurrency  String   // siempre "EUR": moneda pivote
  quoteCurrency String
  rate          Decimal  @db.Decimal(18, 8)
  provider      String   // "frankfurter"

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([date, baseCurrency, quoteCurrency])
  @@index([date])
}
```

- [ ] **Step 6: Formatear y generar el cliente**

Run: `cd spendly-backend && npx prisma format && npx prisma generate`
Expected: sin errores; `node_modules/.prisma/client` regenerado con los campos nuevos y el modelo `ExchangeRate`.

- [ ] **Step 7: Aplicar el schema a la base de datos**

Run: `cd spendly-backend && npx prisma db push`
Expected: Prisma reporta las columnas y la tabla nuevas añadidas, "The database is now in sync with your Prisma schema". Si este entorno no tiene red hacia la base de datos de producción/desarrollo (`DATABASE_URL`), este paso lo ejecuta el usuario — reportarlo explícitamente en vez de darlo por hecho.

- [ ] **Step 8: Backfill explícito (cinturón y tirantes sobre el `@default`)**

Ejecutar contra la misma base de datos, vía `npx prisma db execute --stdin` o un script puntual:

```sql
UPDATE "Transaction" SET currency = 'EUR' WHERE currency IS NULL;
UPDATE "Budget" SET currency = 'EUR' WHERE currency IS NULL;
UPDATE "Trip" SET currency = 'EUR' WHERE currency IS NULL;
UPDATE "Debt" d SET currency = COALESCE(
  (SELECT w.currency FROM "Wallet" w WHERE w.id = d."walletId"), 'EUR'
) WHERE d.currency IS NULL;
```

Expected: 0 filas afectadas si el `@default("EUR")` de Step 7 ya las cubrió (esperable); si acaso alguna fila quedó `NULL` por una carrera con `db push`, este paso la corrige.

- [ ] **Step 9: Commit**

```bash
cd spendly-backend
git add prisma/schema.prisma
git commit -m "feat(schema): campos multi-currency en Transaction/Budget/Trip/Debt + modelo ExchangeRate"
```

---

## Fase 2 — CurrencyService (checkpoint: revisar conversiones antes de continuar)

### Task 2: Interfaz ExchangeRateProvider y constantes del módulo

**Files:**
- Create: `spendly-backend/src/modules/currency/currency.types.ts`
- Create: `spendly-backend/src/modules/currency/currency.constants.ts`

**Interfaces:**
- Produces: `ExchangeRateProvider` (interfaz), `EXCHANGE_RATE_PROVIDER` (token de inyección), `PIVOT_CURRENCY`, `ZERO_DECIMAL_CURRENCIES` — los consume `FrankfurterProvider` (Task 3), `CurrencyModule` (Task 4) y `CurrencyService` (Task 4).

- [ ] **Step 1: Crear `currency.types.ts`**

```ts
// spendly-backend/src/modules/currency/currency.types.ts

// Contrato que debe cumplir cualquier fuente de tipos de cambio. CurrencyService
// solo conoce esta interfaz — cambiar de proveedor es cambiar el `provide` en
// CurrencyModule (Task 4), nunca tocar CurrencyService ni sus consumidores.
export interface ExchangeRateProvider {
  // Tipos actuales: 1 `base` = X `quote`, para cada moneda en `quotes`.
  getLatestRates(base: string, quotes: string[]): Promise<Record<string, number>>;

  // Tipo para una fecha concreta. `null` si el proveedor no tiene dato (caído,
  // fecha fuera de su cobertura) — nunca lanza para "no hay dato", solo para
  // errores de transporte inesperados que el llamador deba loguear.
  getHistoricalRate(base: string, quote: string, date: Date): Promise<number | null>;
}
```

- [ ] **Step 2: Crear `currency.constants.ts`**

```ts
// spendly-backend/src/modules/currency/currency.constants.ts

export const EXCHANGE_RATE_PROVIDER = 'EXCHANGE_RATE_PROVIDER';

// Todas las conversiones pasan por EUR: nunca se guarda una fila cruzada
// (p.ej. CHF->USD) en ExchangeRate, se calcula en memoria vía este pivote.
export const PIVOT_CURRENCY = 'EUR';

// Monedas que no usan decimales (Intl.NumberFormat/redondeo). Añadir una
// moneda nueva sin decimales es una línea aquí.
export const ZERO_DECIMAL_CURRENCIES = new Set(['JPY']);
```

- [ ] **Step 3: Commit**

```bash
cd spendly-backend
git add src/modules/currency/currency.types.ts src/modules/currency/currency.constants.ts
git commit -m "feat(currency): interfaz ExchangeRateProvider y constantes del modulo"
```

### Task 3: FrankfurterProvider

Confirmado contra la API real (`https://api.frankfurter.dev/v1`): `GET /latest?base=EUR&symbols=CHF,USD` devuelve `{amount, base, date, rates: {CHF: 0.9393, USD: 1.1463}}`; `GET /2026-09-20?base=EUR&symbols=CHF` (un domingo) devuelve el último día hábil (`date: "2026-09-18"`) sin error — el proveedor resuelve fines de semana/festivos solo.

**Files:**
- Create: `spendly-backend/src/modules/currency/frankfurter.provider.ts`
- Test: `spendly-backend/src/modules/currency/frankfurter.provider.spec.ts`

**Interfaces:**
- Consumes: `ExchangeRateProvider` (Task 2, `currency.types.ts`).
- Produces: `FrankfurterProvider` (clase inyectable que implementa `ExchangeRateProvider`), consumida por `CurrencyModule` (Task 4).

- [ ] **Step 1: Escribir el test (con axios mockeado)**

```ts
// spendly-backend/src/modules/currency/frankfurter.provider.spec.ts
import axios from 'axios';
import { FrankfurterProvider } from './frankfurter.provider';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('FrankfurterProvider', () => {
  const http = { get: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    mockedAxios.create.mockReturnValue(http as any);
  });

  it('getLatestRates devuelve el mapa de rates', async () => {
    http.get.mockResolvedValue({ data: { base: 'EUR', date: '2026-09-22', rates: { CHF: 0.9393, USD: 1.1463 } } });
    const provider = new FrankfurterProvider();

    const rates = await provider.getLatestRates('EUR', ['CHF', 'USD']);

    expect(rates).toEqual({ CHF: 0.9393, USD: 1.1463 });
    expect(http.get).toHaveBeenCalledWith('/latest', { params: { base: 'EUR', symbols: 'CHF,USD' } });
  });

  it('getLatestRates con lista vacía no llama a la API', async () => {
    const provider = new FrankfurterProvider();
    const rates = await provider.getLatestRates('EUR', []);
    expect(rates).toEqual({});
    expect(http.get).not.toHaveBeenCalled();
  });

  it('getHistoricalRate devuelve el rate para esa fecha', async () => {
    http.get.mockResolvedValue({ data: { base: 'EUR', date: '2026-09-01', rates: { CHF: 0.94 } } });
    const provider = new FrankfurterProvider();

    const rate = await provider.getHistoricalRate('EUR', 'CHF', new Date('2026-09-01T00:00:00.000Z'));

    expect(rate).toBe(0.94);
    expect(http.get).toHaveBeenCalledWith('/2026-09-01', { params: { base: 'EUR', symbols: 'CHF' } });
  });

  it('getHistoricalRate devuelve null si la API falla (nunca lanza)', async () => {
    http.get.mockRejectedValue(new Error('network down'));
    const provider = new FrankfurterProvider();

    const rate = await provider.getHistoricalRate('EUR', 'CHF', new Date('2026-09-01T00:00:00.000Z'));

    expect(rate).toBeNull();
  });

  it('getHistoricalRate devuelve null si la respuesta no trae la moneda pedida', async () => {
    http.get.mockResolvedValue({ data: { base: 'EUR', date: '2026-09-01', rates: {} } });
    const provider = new FrankfurterProvider();

    const rate = await provider.getHistoricalRate('EUR', 'CHF', new Date('2026-09-01T00:00:00.000Z'));

    expect(rate).toBeNull();
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest currency/frankfurter.provider -v`
Expected: FAIL — `Cannot find module './frankfurter.provider'`.

- [ ] **Step 3: Implementar `FrankfurterProvider`**

```ts
// spendly-backend/src/modules/currency/frankfurter.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ExchangeRateProvider } from './currency.types';

@Injectable()
export class FrankfurterProvider implements ExchangeRateProvider {
  private readonly logger = new Logger(FrankfurterProvider.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({ baseURL: 'https://api.frankfurter.dev/v1', timeout: 10000 });
  }

  async getLatestRates(base: string, quotes: string[]): Promise<Record<string, number>> {
    if (!quotes.length) return {};
    try {
      const { data } = await this.http.get('/latest', { params: { base, symbols: quotes.join(',') } });
      return data?.rates ?? {};
    } catch (err) {
      this.logger.warn(`getLatestRates(${base}, [${quotes.join(',')}]) failed: ${(err as Error).message}`);
      return {};
    }
  }

  async getHistoricalRate(base: string, quote: string, date: Date): Promise<number | null> {
    const day = date.toISOString().slice(0, 10); // "YYYY-MM-DD"
    try {
      const { data } = await this.http.get(`/${day}`, { params: { base, symbols: quote } });
      const rate = data?.rates?.[quote];
      return typeof rate === 'number' ? rate : null;
    } catch (err) {
      this.logger.warn(`getHistoricalRate(${base}, ${quote}, ${day}) failed: ${(err as Error).message}`);
      return null;
    }
  }
}
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest currency/frankfurter.provider -v`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
cd spendly-backend
git add src/modules/currency/frankfurter.provider.ts src/modules/currency/frankfurter.provider.spec.ts
git commit -m "feat(currency): FrankfurterProvider (BCE, api.frankfurter.dev)"
```

### Task 4: CurrencyService + CurrencyModule

**Files:**
- Create: `spendly-backend/src/modules/currency/currency.service.ts`
- Create: `spendly-backend/src/modules/currency/currency.module.ts`
- Test: `spendly-backend/src/modules/currency/currency.service.spec.ts`

**Interfaces:**
- Consumes: `ExchangeRateProvider`/`EXCHANGE_RATE_PROVIDER`/`PIVOT_CURRENCY`/`ZERO_DECIMAL_CURRENCIES` (Task 2), `FrankfurterProvider` (Task 3), `PrismaService` (`spendly-backend/src/common/prisma/prisma.service.ts`, ya existente).
- Produces: `CurrencyService` con `getCurrentRate(from, to): Promise<Prisma.Decimal>`, `getHistoricalRate(from, to, date): Promise<Prisma.Decimal>`, `convert(amount, from, to, date?): Promise<Prisma.Decimal>`, `convertToBase(userId, amount, currency, date?): Promise<Prisma.Decimal>`, `round(amount, currency): Prisma.Decimal`, `getActiveCurrencies(): Promise<string[]>`. `CurrencyModule` exporta `CurrencyService`, lo consumen las Fases 3-6.

- [ ] **Step 1: Escribir el test**

```ts
// spendly-backend/src/modules/currency/currency.service.spec.ts
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CurrencyService } from './currency.service';
import { ExchangeRateProvider } from './currency.types';

function buildPrismaMock() {
  return {
    exchangeRate: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
    },
    wallet: { findMany: jest.fn().mockResolvedValue([]) },
    transaction: { findMany: jest.fn().mockResolvedValue([]) },
    goal: { findMany: jest.fn().mockResolvedValue([]) },
    trip: { findMany: jest.fn().mockResolvedValue([]) },
    budget: { findMany: jest.fn().mockResolvedValue([]) },
    debt: { findMany: jest.fn().mockResolvedValue([]) },
    investmentAsset: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  } as any;
}

function buildProviderMock(): jest.Mocked<ExchangeRateProvider> {
  return { getLatestRates: jest.fn(), getHistoricalRate: jest.fn() };
}

describe('CurrencyService', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let provider: jest.Mocked<ExchangeRateProvider>;
  let service: CurrencyService;

  beforeEach(() => {
    prisma = buildPrismaMock();
    provider = buildProviderMock();
    service = new CurrencyService(prisma, provider);
  });

  it('from === to no toca la base de datos', async () => {
    const rate = await service.getCurrentRate('EUR', 'EUR');
    expect(rate.toNumber()).toBe(1);
    expect(prisma.exchangeRate.findFirst).not.toHaveBeenCalled();
  });

  it('getCurrentRate EUR->CHF lee la fila más reciente en cache', async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const rate = await service.getCurrentRate('EUR', 'CHF');
    expect(rate.toString()).toBe('0.9393');
  });

  it('getCurrentRate CHF->EUR invierte la fila EUR->CHF', async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const rate = await service.getCurrentRate('CHF', 'EUR');
    expect(rate.toNumber()).toBeCloseTo(1 / 0.9393, 6);
  });

  it('getCurrentRate CHF->USD hace cross-rate vía EUR sin fila propia', async () => {
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce({ rate: new Prisma.Decimal('0.9393') }) // EUR->CHF
      .mockResolvedValueOnce({ rate: new Prisma.Decimal('1.1463') }); // EUR->USD
    const rate = await service.getCurrentRate('CHF', 'USD');
    expect(rate.toNumber()).toBeCloseTo(1.1463 / 0.9393, 6);
  });

  it('convert aplica el rate al importe', async () => {
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const converted = await service.convert(100, 'EUR', 'CHF');
    expect(converted.toNumber()).toBeCloseTo(93.93, 2);
  });

  it('convertToBase usa la moneda del usuario', async () => {
    prisma.user = { findMany: jest.fn() } as any;
    (prisma as any).user.findUnique = jest.fn().mockResolvedValue({ currency: 'CHF' });
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.9393') });
    const converted = await service.convertToBase(1, 100, 'EUR');
    expect(converted.toNumber()).toBeCloseTo(93.93, 2);
  });

  it('getHistoricalRate lee primero la fila exacta de esa fecha', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst.mockResolvedValue({ rate: new Prisma.Decimal('0.94') });
    const rate = await service.getHistoricalRate('EUR', 'CHF', date);
    expect(rate.toString()).toBe('0.94');
    expect(provider.getHistoricalRate).not.toHaveBeenCalled();
  });

  it('getHistoricalRate sin fila cae al provider y la persiste', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst.mockResolvedValue(null);
    provider.getHistoricalRate.mockResolvedValue(0.94);
    prisma.exchangeRate.upsert.mockResolvedValue({ rate: new Prisma.Decimal('0.94') });

    const rate = await service.getHistoricalRate('EUR', 'CHF', date);

    expect(rate.toString()).toBe('0.94');
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { date_baseCurrency_quoteCurrency: { date, baseCurrency: 'EUR', quoteCurrency: 'CHF' } },
        create: expect.objectContaining({ baseCurrency: 'EUR', quoteCurrency: 'CHF', provider: 'frankfurter' }),
      }),
    );
  });

  it('provider caído sin cache previo: excepción controlada', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce(null) // fila exacta
      .mockResolvedValueOnce(null); // fallback: ninguna fila anterior
    provider.getHistoricalRate.mockResolvedValue(null);

    await expect(service.getHistoricalRate('EUR', 'CHF', date)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('provider caído con cache previo: usa el último rate conocido', async () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    prisma.exchangeRate.findFirst
      .mockResolvedValueOnce(null) // fila exacta para esa fecha
      .mockResolvedValueOnce({ rate: new Prisma.Decimal('0.93') }); // última fila anterior
    provider.getHistoricalRate.mockResolvedValue(null);

    const rate = await service.getHistoricalRate('EUR', 'CHF', date);
    expect(rate.toString()).toBe('0.93');
  });

  it('round: JPY sin decimales, EUR con 2', () => {
    expect(service.round(1234.567, 'JPY').toString()).toBe('1235');
    expect(service.round(1234.567, 'EUR').toString()).toBe('1234.57');
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest currency/currency.service -v`
Expected: FAIL — `Cannot find module './currency.service'`.

- [ ] **Step 3: Implementar `CurrencyService`**

```ts
// spendly-backend/src/modules/currency/currency.service.ts
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EXCHANGE_RATE_PROVIDER, PIVOT_CURRENCY, ZERO_DECIMAL_CURRENCIES } from './currency.constants';
import { ExchangeRateProvider } from './currency.types';

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

@Injectable()
export class CurrencyService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EXCHANGE_RATE_PROVIDER) private readonly provider: ExchangeRateProvider,
  ) {}

  // Tipo EUR->quote más reciente en cache (lo escribe el cron, Task 5).
  // Devuelve null si no hay ninguna fila todavía para esa moneda.
  private async latestPivotRate(quote: string): Promise<Prisma.Decimal | null> {
    const row = await this.prisma.exchangeRate.findFirst({
      where: { baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote },
      orderBy: { date: 'desc' },
    });
    return row ? new Prisma.Decimal(row.rate) : null;
  }

  async getCurrentRate(from: string, to: string): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);

    if (from === PIVOT_CURRENCY) {
      const rate = await this.latestPivotRate(to);
      if (!rate) throw new ServiceUnavailableException(`No hay tipo de cambio EUR->${to} disponible.`);
      return rate;
    }
    if (to === PIVOT_CURRENCY) {
      const rate = await this.latestPivotRate(from);
      if (!rate) throw new ServiceUnavailableException(`No hay tipo de cambio EUR->${from} disponible.`);
      return new Prisma.Decimal(1).dividedBy(rate);
    }

    // Cruce: from->EUR->to, ninguna fila propia para el par.
    const [fromToEur, eurToTarget] = await Promise.all([this.getCurrentRate(from, PIVOT_CURRENCY), this.getCurrentRate(PIVOT_CURRENCY, to)]);
    return fromToEur.times(eurToTarget);
  }

  async convert(amount: number | Prisma.Decimal, from: string, to: string, date?: Date): Promise<Prisma.Decimal> {
    const rate = date ? await this.getHistoricalRate(from, to, date) : await this.getCurrentRate(from, to);
    return new Prisma.Decimal(amount).times(rate);
  }

  async convertToBase(userId: number, amount: number | Prisma.Decimal, currency: string, date?: Date): Promise<Prisma.Decimal> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
    const base = user?.currency ?? PIVOT_CURRENCY;
    return this.convert(amount, currency, base, date);
  }

  async getHistoricalRate(from: string, to: string, date: Date): Promise<Prisma.Decimal> {
    if (from === to) return new Prisma.Decimal(1);

    if (from !== PIVOT_CURRENCY && to !== PIVOT_CURRENCY) {
      const [fromToEur, eurToTarget] = await Promise.all([
        this.getHistoricalRate(from, PIVOT_CURRENCY, date),
        this.getHistoricalRate(PIVOT_CURRENCY, to, date),
      ]);
      return fromToEur.times(eurToTarget);
    }

    // A partir de aquí, uno de los dos es EUR: se busca/guarda como EUR->quote,
    // invirtiendo si hace falta.
    const quote = from === PIVOT_CURRENCY ? to : from;
    const day = startOfUtcDay(date);

    const existing = await this.prisma.exchangeRate.findFirst({
      where: { date: day, baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote },
    });
    let rate: Prisma.Decimal;

    if (existing) {
      rate = new Prisma.Decimal(existing.rate);
    } else {
      const fetched = await this.provider.getHistoricalRate(PIVOT_CURRENCY, quote, day);
      if (fetched != null) {
        const saved = await this.prisma.exchangeRate.upsert({
          where: { date_baseCurrency_quoteCurrency: { date: day, baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote } },
          create: { date: day, baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote, rate: fetched, provider: 'frankfurter' },
          update: { rate: fetched, provider: 'frankfurter' },
        });
        rate = new Prisma.Decimal(saved.rate);
      } else {
        // Provider caído: fallback al último rate conocido ANTERIOR a esa fecha.
        // Nunca se inventa un número que no venga de una fila real o del provider.
        const fallback = await this.prisma.exchangeRate.findFirst({
          where: { baseCurrency: PIVOT_CURRENCY, quoteCurrency: quote, date: { lt: day } },
          orderBy: { date: 'desc' },
        });
        if (!fallback) {
          throw new ServiceUnavailableException(`No se pudo obtener el tipo de cambio EUR->${quote} para ${day.toISOString().slice(0, 10)} ni hay uno anterior en cache.`);
        }
        rate = new Prisma.Decimal(fallback.rate);
      }
    }

    return from === PIVOT_CURRENCY ? rate : new Prisma.Decimal(1).dividedBy(rate);
  }

  round(amount: number | Prisma.Decimal, currency: string): Prisma.Decimal {
    const decimals = ZERO_DECIMAL_CURRENCIES.has(currency) ? 0 : 2;
    return new Prisma.Decimal(amount).toDecimalPlaces(decimals, Prisma.Decimal.ROUND_HALF_UP);
  }

  // Monedas realmente en uso hoy, más EUR siempre — lo consume el cron (Task 5)
  // para saber qué pedirle a Frankfurter cada día.
  async getActiveCurrencies(): Promise<string[]> {
    const [wallets, transactions, goals, trips, budgets, debts, assets, users] = await Promise.all([
      this.prisma.wallet.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] }),
      this.prisma.transaction.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.goal.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.trip.findMany({ select: { currency: true }, distinct: ['currency'] }),
      this.prisma.budget.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] }),
      this.prisma.debt.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] }),
      this.prisma.investmentAsset.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] }),
      this.prisma.user.findMany({ where: { active: true }, select: { currency: true }, distinct: ['currency'] }),
    ]);
    const all = [wallets, transactions, goals, trips, budgets, debts, assets, users].flat().map((r) => r.currency).filter((c): c is string => !!c);
    return Array.from(new Set([PIVOT_CURRENCY, ...all]));
  }
}
```

- [ ] **Step 4: Crear `CurrencyModule`**

```ts
// spendly-backend/src/modules/currency/currency.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { CurrencyService } from './currency.service';
import { EXCHANGE_RATE_PROVIDER } from './currency.constants';
import { FrankfurterProvider } from './frankfurter.provider';

@Module({
  imports: [PrismaModule],
  providers: [CurrencyService, { provide: EXCHANGE_RATE_PROVIDER, useClass: FrankfurterProvider }],
  exports: [CurrencyService],
})
export class CurrencyModule {}
```

- [ ] **Step 5: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest currency/currency.service -v`
Expected: PASS — 12 tests.

- [ ] **Step 6: Registrar `CurrencyModule` en `AppModule`**

Modify `spendly-backend/src/app.module.ts`: añadir `import { CurrencyModule } from './modules/currency/currency.module';` y `CurrencyModule` a la lista de `imports` del `@Module`.

- [ ] **Step 7: Compilar y comprobar que no rompe nada**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos.

- [ ] **Step 8: Commit**

```bash
cd spendly-backend
git add src/modules/currency/currency.service.ts src/modules/currency/currency.module.ts src/modules/currency/currency.service.spec.ts src/app.module.ts
git commit -m "feat(currency): CurrencyService (rates, conversion, cross-rate via EUR) + CurrencyModule"
```

### Task 5: Cron diario de actualización de tipos de cambio

**Files:**
- Create: `spendly-backend/src/modules/currency/exchange-rate-updater.scheduler.ts`
- Test: `spendly-backend/src/modules/currency/exchange-rate-updater.scheduler.spec.ts`
- Modify: `spendly-backend/src/modules/currency/currency.module.ts`

**Interfaces:**
- Consumes: `CurrencyService.getActiveCurrencies()` (Task 4), `EXCHANGE_RATE_PROVIDER`/`PIVOT_CURRENCY` (Task 2), `PrismaService`.
- Produces: `ExchangeRateUpdaterScheduler` con `handleDailyUpdate(): Promise<void>`, registrado como `provider` en `CurrencyModule`.

- [ ] **Step 1: Escribir el test**

```ts
// spendly-backend/src/modules/currency/exchange-rate-updater.scheduler.spec.ts
import { ExchangeRateUpdaterScheduler } from './exchange-rate-updater.scheduler';

describe('ExchangeRateUpdaterScheduler', () => {
  it('pide al provider todas las monedas activas salvo EUR y guarda una fila por cada una', async () => {
    const currencyService = { getActiveCurrencies: jest.fn().mockResolvedValue(['EUR', 'CHF', 'USD']) } as any;
    const provider = { getLatestRates: jest.fn().mockResolvedValue({ CHF: 0.9393, USD: 1.1463 }) } as any;
    const prisma = { exchangeRate: { upsert: jest.fn().mockResolvedValue({}) } } as any;

    const scheduler = new ExchangeRateUpdaterScheduler(currencyService, provider, prisma);
    await scheduler.handleDailyUpdate();

    expect(provider.getLatestRates).toHaveBeenCalledWith('EUR', ['CHF', 'USD']);
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.exchangeRate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ baseCurrency: 'EUR', quoteCurrency: 'CHF', rate: 0.9393, provider: 'frankfurter' }) }),
    );
  });

  it('si el provider no devuelve rates, no falla ni escribe nada', async () => {
    const currencyService = { getActiveCurrencies: jest.fn().mockResolvedValue(['EUR', 'CHF']) } as any;
    const provider = { getLatestRates: jest.fn().mockResolvedValue({}) } as any;
    const prisma = { exchangeRate: { upsert: jest.fn() } } as any;

    const scheduler = new ExchangeRateUpdaterScheduler(currencyService, provider, prisma);
    await expect(scheduler.handleDailyUpdate()).resolves.not.toThrow();
    expect(prisma.exchangeRate.upsert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest exchange-rate-updater -v`
Expected: FAIL — módulo no encontrado.

- [ ] **Step 3: Implementar el scheduler**

```ts
// spendly-backend/src/modules/currency/exchange-rate-updater.scheduler.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrencyService } from './currency.service';
import { EXCHANGE_RATE_PROVIDER, PIVOT_CURRENCY } from './currency.constants';
import { ExchangeRateProvider } from './currency.types';

function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

@Injectable()
export class ExchangeRateUpdaterScheduler {
  private readonly logger = new Logger(ExchangeRateUpdaterScheduler.name);

  constructor(
    private readonly currencyService: CurrencyService,
    @Inject(EXCHANGE_RATE_PROVIDER) private readonly provider: ExchangeRateProvider,
    private readonly prisma: PrismaService,
  ) {}

  // 07:00 todos los días — mismo patrón que TransactionsRecurringScheduler.
  @Cron('0 0 7 * * *')
  async handleDailyUpdate() {
    try {
      const active = await this.currencyService.getActiveCurrencies();
      const quotes = active.filter((c) => c !== PIVOT_CURRENCY);
      if (!quotes.length) return;

      const rates = await this.provider.getLatestRates(PIVOT_CURRENCY, quotes);
      const date = todayUtc();

      for (const [quoteCurrency, rate] of Object.entries(rates)) {
        await this.prisma.exchangeRate.upsert({
          where: { date_baseCurrency_quoteCurrency: { date, baseCurrency: PIVOT_CURRENCY, quoteCurrency } },
          create: { date, baseCurrency: PIVOT_CURRENCY, quoteCurrency, rate, provider: 'frankfurter' },
          update: { rate, provider: 'frankfurter' },
        });
      }
      this.logger.log(`Tipos de cambio actualizados para ${Object.keys(rates).length} monedas.`);
    } catch (error) {
      this.logger.error('Error al actualizar tipos de cambio', error as Error);
    }
  }
}
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest exchange-rate-updater -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Registrar el scheduler en `CurrencyModule`**

Modify `spendly-backend/src/modules/currency/currency.module.ts`: añadir `ExchangeRateUpdaterScheduler` al array `providers`.

- [ ] **Step 6: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
cd spendly-backend
git add src/modules/currency/exchange-rate-updater.scheduler.ts src/modules/currency/exchange-rate-updater.scheduler.spec.ts src/modules/currency/currency.module.ts
git commit -m "feat(currency): cron diario de actualizacion de tipos de cambio (07:00)"
```

**CHECKPOINT Fase 2:** antes de seguir, ejecutar `cd spendly-backend && npx jest currency -v` completo (19 tests entre las 3 tareas) y confirmar que todo pasa. Es el módulo del que depende todo lo demás.

---

## Fase 3 — Transaction + patrimonio neto

### Task 6: `Transaction.currency`/`baseAmount` al crear

**Files:**
- Modify: `spendly-backend/src/modules/transactions/dto/create-transaction.dto.ts`
- Modify: `spendly-backend/src/modules/transactions/transactions.service.ts`
- Modify: `spendly-backend/src/modules/transactions/transactions.module.ts`
- Test: `spendly-backend/src/modules/transactions/transactions.service.spec.ts` (ya existe — añadir casos)

**Interfaces:**
- Consumes: `CurrencyService.convertToBase(userId, amount, currency, date?)` y `CurrencyService.getCurrentRate` (Task 4).
- Produces: `Transaction.currency`/`baseAmount`/`exchangeRate` rellenos al crear; lo consume el Task 9 (estadísticas).

- [ ] **Step 1: Añadir `currency` opcional al DTO**

En `create-transaction.dto.ts`, después del campo `amount`:

```ts
  @IsNumber()
  amount: number;

  // ISO 4217. Si no se manda, el service la rellena con la moneda de la
  // cartera elegida (walletId/fromWalletId) o con la moneda base del usuario.
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 de 3 letras' })
  currency?: string;
```

Añadir `Matches` al import de `class-validator` en la primera línea del archivo.

- [ ] **Step 2: Añadir el test de `baseAmount`**

Añadir a `spendly-backend/src/modules/transactions/transactions.service.spec.ts` (el archivo ya existe con el describe de fechas de plantillas recurrentes — añadir un describe nuevo):

```ts
describe('TransactionsService.create — currency/baseAmount', () => {
  function build() {
    const prisma: any = {
      transaction: { create: jest.fn(), findUnique: jest.fn() },
      wallet: { findUnique: jest.fn().mockResolvedValue({ id: 3, balance: 100, currency: 'EUR' }), update: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ currency: 'EUR' }) },
    };
    const currencyService: any = {
      convertToBase: jest.fn(),
    };
    const service = new TransactionsService(prisma, {} as any, {} as any, currencyService);
    return { service, prisma, currencyService };
  }

  it('transaccion en la moneda base: currency=EUR y baseAmount queda NULL', async () => {
    const { service, prisma, currencyService } = build();
    prisma.transaction.create.mockResolvedValue({ id: 1, type: 'expense', amount: 10, walletId: 3, currency: 'EUR', baseAmount: null });

    await service.create(7, { type: 'expense', amount: 10, walletId: 3, date: '2026-09-22' } as any);

    expect(currencyService.convertToBase).not.toHaveBeenCalled();
    expect(prisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ currency: 'EUR', baseAmount: null, exchangeRate: null }) }),
    );
  });

  it('transaccion en otra moneda: calcula baseAmount con el tipo historico de la fecha', async () => {
    const { service, prisma, currencyService } = build();
    prisma.wallet.findUnique.mockResolvedValue({ id: 3, balance: 100, currency: 'CHF' });
    currencyService.convertToBase.mockResolvedValue({ toNumber: () => 53.72, div: () => ({ toNumber: () => 0.9313 }) });
    prisma.transaction.create.mockResolvedValue({ id: 1 });

    await service.create(7, { type: 'expense', amount: 50, walletId: 3, currency: 'CHF', date: '2026-09-01' } as any);

    expect(currencyService.convertToBase).toHaveBeenCalledWith(7, 50, 'CHF', new Date('2026-09-01'));
    const data = prisma.transaction.create.mock.calls[0][0].data;
    expect(data.currency).toBe('CHF');
    expect(data.baseAmount).toBe(53.72);
  });
});
```

- [ ] **Step 3: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest transactions.service -v`
Expected: FAIL — `TransactionsService` no acepta un 4º argumento `currencyService` todavía / `baseAmount` no se calcula.

- [ ] **Step 4: Inyectar `CurrencyService` y calcular `baseAmount` en `create()`**

Modify `spendly-backend/src/modules/transactions/transactions.service.ts`:

```ts
// en el constructor, añadir el 4º parámetro:
constructor(
  private prisma: PrismaService,
  private notifications: NotificationsService,
  private budgets: BudgetsService,
  private currency: CurrencyService,
) {}
```

Y en `async create(userId: number, dto: CreateTransactionDto)`, justo antes de `const transaction = await this.prisma.transaction.create({`:

```ts
    // Moneda del movimiento: la que venga explícita en el DTO, si no la de la
    // cartera elegida, si no la moneda base del usuario. baseAmount/exchangeRate
    // se calculan UNA VEZ aquí, con el tipo histórico de `rawDate` — no se
    // recalculan después aunque cambie el tipo de cambio más adelante.
    const walletForCurrency = rest.walletId ?? rest.fromWalletId;
    const wallet = walletForCurrency
      ? await this.prisma.wallet.findUnique({ where: { id: walletForCurrency }, select: { currency: true } })
      : null;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
    const baseCurrency = user?.currency ?? 'EUR';
    const txCurrency = (dto as any).currency ?? wallet?.currency ?? baseCurrency;

    let baseAmount: number | null = null;
    let exchangeRate: number | null = null;
    if (txCurrency !== baseCurrency) {
      const converted = await this.currency.convertToBase(userId, rest.amount, txCurrency, rawDate);
      baseAmount = converted.toNumber();
      exchangeRate = converted.dividedBy(rest.amount).toNumber();
    }
```

Y dentro del `data: { ... }` de `this.prisma.transaction.create`, añadir:

```ts
      data: {
        ...rest,
        currency: txCurrency,
        baseAmount,
        exchangeRate,
        userId,
        date: rawDate,
        isRecurring: false,
        recurrence: null,
        parentId: parentId ?? null,
      },
```

Añadir el import al principio del archivo: `import { CurrencyService } from '../currency/currency.service';`.

- [ ] **Step 5: Actualizar `TransactionsModule` para inyectar `CurrencyModule`**

Modify `spendly-backend/src/modules/transactions/transactions.module.ts`: añadir `import { CurrencyModule } from '../currency/currency.module';` y `CurrencyModule` al array `imports`.

- [ ] **Step 6: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest transactions.service -v`
Expected: PASS — todos los tests del archivo, incluidos los 3 ya existentes de fechas de recurrentes.

- [ ] **Step 7: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
cd spendly-backend
git add src/modules/transactions/dto/create-transaction.dto.ts src/modules/transactions/transactions.service.ts src/modules/transactions/transactions.module.ts src/modules/transactions/transactions.service.spec.ts
git commit -m "feat(transactions): calcula currency/baseAmount/exchangeRate al crear via CurrencyService"
```

### Task 7: Endpoint de patrimonio neto convertido

**Files:**
- Modify: `spendly-backend/src/modules/dashboard/dashboard.service.ts`
- Modify: `spendly-backend/src/modules/dashboard/dashboard.controller.ts`
- Modify: `spendly-backend/src/modules/dashboard/dashboard.module.ts`
- Test: `spendly-backend/src/modules/dashboard/dashboard.service.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `CurrencyService.getCurrentRate(from, to)` (Task 4).
- Produces: `DashboardService.getNetWorth(userId): Promise<{ total: number; currency: string; wallets: Array<{ id: number; name: string; emoji: string; balance: number; currency: string; balanceInBase: number }> }>`, expuesto en `GET /dashboard/net-worth`. Lo consume el Task 8 (frontend).

- [ ] **Step 1: Escribir el test**

```ts
// spendly-backend/src/modules/dashboard/dashboard.service.spec.ts
import { DashboardService } from './dashboard.service';

describe('DashboardService.getNetWorth', () => {
  function build(wallets: any[], userCurrency: string, rate = 0.9393) {
    const prisma: any = {
      wallet: { findMany: jest.fn().mockResolvedValue(wallets) },
      user: { findUnique: jest.fn().mockResolvedValue({ currency: userCurrency }) },
    };
    const currency: any = { getCurrentRate: jest.fn().mockResolvedValue({ toNumber: () => rate, times: (n: number) => ({ toNumber: () => n * rate }) }) };
    return { service: new DashboardService(prisma, currency), prisma, currency };
  }

  it('todas las carteras en la moneda base: suma directa, sin llamar a CurrencyService', async () => {
    const { service, currency } = build(
      [{ id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR' }, { id: 2, name: 'Efectivo', emoji: '💵', balance: 50, currency: 'EUR' }],
      'EUR',
    );

    const result = await service.getNetWorth(7);

    expect(result).toEqual({
      total: 150,
      currency: 'EUR',
      wallets: [
        { id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR', balanceInBase: 100 },
        { id: 2, name: 'Efectivo', emoji: '💵', balance: 50, currency: 'EUR', balanceInBase: 50 },
      ],
    });
    expect(currency.getCurrentRate).not.toHaveBeenCalled();
  });

  it('cartera en otra moneda: convierte al tipo actual', async () => {
    const { service, currency } = build(
      [{ id: 1, name: 'Santander', emoji: '🏦', balance: 100, currency: 'EUR' }, { id: 2, name: 'Revolut CHF', emoji: '💳', balance: 2000, currency: 'CHF' }],
      'EUR',
    );

    const result = await service.getNetWorth(7);

    expect(currency.getCurrentRate).toHaveBeenCalledWith('CHF', 'EUR');
    expect(result.total).toBeCloseTo(100 + 2000 * 0.9393, 2);
    expect(result.wallets[1].balanceInBase).toBeCloseTo(2000 * 0.9393, 2);
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest dashboard.service -v`
Expected: FAIL — `getNetWorth is not a function`.

- [ ] **Step 3: Implementar `getNetWorth`**

Modify `spendly-backend/src/modules/dashboard/dashboard.service.ts`: añadir el import `import { CurrencyService } from '../currency/currency.service';`, añadir `currency: CurrencyService` al `constructor`, y añadir el método (por ejemplo, justo antes de `async getTrends`):

```ts
  async getNetWorth(userId: number) {
    const [wallets, user] = await Promise.all([
      this.prisma.wallet.findMany({
        where: { userId, active: true },
        select: { id: true, name: true, emoji: true, balance: true, currency: true },
        orderBy: { position: 'asc' },
      }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } }),
    ]);
    const baseCurrency = user?.currency ?? 'EUR';

    const withBase = await Promise.all(
      wallets.map(async (w) => {
        if (w.currency === baseCurrency) return { ...w, balanceInBase: w.balance };
        const rate = await this.currency.getCurrentRate(w.currency, baseCurrency);
        return { ...w, balanceInBase: rate.times(w.balance).toNumber() };
      }),
    );

    return {
      total: withBase.reduce((sum, w) => sum + w.balanceInBase, 0),
      currency: baseCurrency,
      wallets: withBase,
    };
  }
```

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest dashboard.service -v`
Expected: PASS — 2 tests.

- [ ] **Step 5: Exponer el endpoint**

Modify `spendly-backend/src/modules/dashboard/dashboard.controller.ts`: añadir, junto a los demás `@Get`:

```ts
  @Get('net-worth')
  getNetWorth(@User('id') userId: number) {
    return this.dashboardService.getNetWorth(userId);
  }
```

- [ ] **Step 6: Inyectar `CurrencyModule` en `DashboardModule`**

Modify `spendly-backend/src/modules/dashboard/dashboard.module.ts`: añadir `import { CurrencyModule } from '../currency/currency.module';` y `CurrencyModule` a `imports`.

- [ ] **Step 7: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
cd spendly-backend
git add src/modules/dashboard/dashboard.service.ts src/modules/dashboard/dashboard.controller.ts src/modules/dashboard/dashboard.module.ts src/modules/dashboard/dashboard.service.spec.ts
git commit -m "feat(dashboard): GET /dashboard/net-worth con carteras convertidas a la moneda base"
```

### Task 8: Frontend — `useNetWorthTrend` consume el patrimonio ya convertido

**Alcance de esta tarea (importante, léelo antes de tocar código):** `useNetWorthTrend.ts` calcula hoy el patrimonio actual (`current`) sumando `wallet.balance` en crudo (línea `current = walletsQuery.data.reduce(...)`). Esta tarea sustituye SOLO esa suma por el nuevo endpoint — es lo único que el spec (sección 9, "Patrimonio") pide para esta entrega. El resto del hook (`wealthSeries`/serie histórica mensual, que combina `Transaction`+`ManualMonthData`+`InvestmentValuationSnapshot`) sigue sumando importes en crudo, sin convertir — es un motor mucho más grande, fuera de alcance de esta entrega, y así hay que decírselo al usuario al terminar el plan.

**Files:**
- Modify: `spendly/src/hooks/useNetWorthTrend.ts`
- Test: no existe test runner para hooks en este proyecto todavía (solo Vitest para utils puros) — se verifica manualmente en el checkpoint final (Task 18).

**Interfaces:**
- Consumes: `GET /dashboard/net-worth` (Task 7) → `{ total, currency, wallets: Array<{ id, name, emoji, balance, currency, balanceInBase }> }`.
- Produces: `NetWorthWallet` gana `currency: string` y `balanceInBase: number`; `NetWorthTrend.current` sale de `total`, no de una suma local.

- [ ] **Step 1: Ampliar el tipo `NetWorthWallet`**

En `spendly/src/hooks/useNetWorthTrend.ts`, sustituir:

```ts
export interface NetWorthWallet {
  id: number;
  name: string;
  emoji?: string | null;
  balance: number;
}
```

por:

```ts
export interface NetWorthWallet {
  id: number;
  name: string;
  emoji?: string | null;
  balance: number;
  currency: string;
  balanceInBase: number;
}
```

- [ ] **Step 2: Sustituir la query de `/wallets` por `/dashboard/net-worth`**

Sustituir:

```ts
  const walletsQuery = useQuery({
    queryKey: ["netWorthWallets", txVersion],
    queryFn: async () => (await api.get("/wallets")).data as NetWorthWallet[],
    staleTime: 1000 * 30,
  });
```

por:

```ts
  const netWorthQuery = useQuery({
    queryKey: ["netWorthCurrent", txVersion],
    queryFn: async () => (await api.get("/dashboard/net-worth")).data as { total: number; currency: string; wallets: NetWorthWallet[] },
    staleTime: 1000 * 30,
  });
```

- [ ] **Step 3: Actualizar las referencias dentro del `useMemo`**

Sustituir `if (!seriesQuery.data || !walletsQuery.data) {` por `if (!seriesQuery.data || !netWorthQuery.data) {`.

Sustituir:

```ts
    // Patrimonio actual real = suma del balance de todas las carteras ahora mismo.
    const current = walletsQuery.data.reduce((sum, w) => sum + Number(w.balance || 0), 0);
```

por:

```ts
    // Patrimonio actual real, ya convertido a la moneda base del usuario por
    // el backend (GET /dashboard/net-worth) — no se convierte nada aquí.
    const current = netWorthQuery.data.total;
```

Sustituir, al final del `useMemo`, `wallets: walletsQuery.data` por `wallets: netWorthQuery.data.wallets`.

Sustituir `isLoading = seriesQuery.isLoading || walletsQuery.isLoading;` por `isLoading = seriesQuery.isLoading || netWorthQuery.isLoading;`, y las dependencias del `useMemo` (`[seriesQuery.data, walletsQuery.data, isLoading, filterType]` → `[seriesQuery.data, netWorthQuery.data, isLoading, filterType]`).

- [ ] **Step 4: Comprobar tipos**

Run: `cd spendly && npx tsc --noEmit -p .`
Expected: sin errores nuevos en `useNetWorthTrend.ts` ni en sus consumidores (`HomeScreen.tsx`, `NetWorthCompositionModal.tsx`, `NetWorthBreakdownModal.tsx` — reciben campos adicionales, no pierden ninguno).

- [ ] **Step 5: Commit**

```bash
cd spendly
git add src/hooks/useNetWorthTrend.ts
git commit -m "feat(net-worth): usa GET /dashboard/net-worth (ya convertido) en vez de sumar balances en el cliente"
```

---

## Fase 4 — Estadísticas (dashboard + budgets)

### Task 9: Estadísticas globales usan `baseAmount` cuando existe

**Files:**
- Modify: `spendly-backend/src/modules/dashboard/dashboard.service.ts`
- Test: `spendly-backend/src/modules/dashboard/dashboard.service.spec.ts` (ampliar)

**Interfaces:**
- Consumes: `Transaction.baseAmount` (Task 1/6).
- No cambia la forma de la respuesta de `getSummary2`/`getByCategory`/`getTrends` — mismos campos, valores correctos con monedas mezcladas.

- [ ] **Step 1: Añadir los tests**

Añadir a `dashboard.service.spec.ts`:

```ts
describe('DashboardService.getSummary2 — multi-currency', () => {
  it('con todo EUR, suma amount tal cual (comportamiento identico al actual)', async () => {
    const prisma: any = {
      transaction: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { amount: 1000, baseAmount: null } }) // income
          .mockResolvedValueOnce({ _sum: { amount: 400, baseAmount: null } }), // expense
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new DashboardService(prisma, {} as any);

    const result = await service.getSummary2(7, {} as any);

    expect(result.totalIncome).toBe(1000);
    expect(result.totalExpenses).toBe(400);
  });

  it('con una transaccion en otra moneda, usa baseAmount para esa fila', async () => {
    const prisma: any = {
      transaction: {
        aggregate: jest.fn()
          .mockResolvedValueOnce({ _sum: { amount: 1000, baseAmount: 950 } }) // income: 1000 EUR + equivalente ya sumado por Prisma en baseAmount
          .mockResolvedValueOnce({ _sum: { amount: 400, baseAmount: 380 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new DashboardService(prisma, {} as any);

    const result = await service.getSummary2(7, {} as any);

    // La aggregate real se hace con _sum: { amount: true } — el service debe
    // pedir tambien baseAmount y preferirlo fila a fila, no confiar en que
    // Prisma sume "amount OR baseAmount" (eso no existe). Este test fija el
    // contrato: aggregate se llama pidiendo ambos campos.
    expect(prisma.transaction.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ _sum: { amount: true, baseAmount: true } }),
    );
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest dashboard.service -v`
Expected: FAIL en el segundo test — `aggregate` se sigue llamando con `_sum: { amount: true }` solo.

**Nota de diseño para el Step 3:** `Prisma.aggregate` con `_sum` sobre dos campos no permite "sumar baseAmount si no es null, si no amount" en SQL — eso exige leer las filas. Como el volumen de transacciones de un usuario en un periodo es pequeño (no miles simultáneas), se sustituye el `aggregate` por `findMany` + reduce en JS, igual que ya se decidió para `budgets` en el diseño (Task 10).

- [ ] **Step 3: Reescribir `getSummary2` para sumar `COALESCE(baseAmount, amount)`**

En `spendly-backend/src/modules/dashboard/dashboard.service.ts`, dentro de `getSummary2`, sustituir el bloque:

```ts
  const [incomeAgg, expenseAgg, investmentTransfers] = await Promise.all([
    this.prisma.transaction.aggregate({
      where: { ...incomeExpenseWhere, type: "income" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.aggregate({
      where: { ...incomeExpenseWhere, type: "expense" },
      _sum: { amount: true },
    }),
    this.prisma.transaction.findMany({
      where: investmentWhere,
      select: {
        amount: true,
        investmentAsset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalIncome = Math.abs(Number(incomeAgg._sum.amount ?? 0));
  const totalExpenses = Math.abs(Number(expenseAgg._sum.amount ?? 0));
```

por:

```ts
  const sumBaseOrAmount = (rows: { amount: number; baseAmount: any }[]) =>
    rows.reduce((sum, r) => sum + Math.abs(Number(r.baseAmount ?? r.amount ?? 0)), 0);

  const [incomeRows, expenseRows, investmentTransfers] = await Promise.all([
    this.prisma.transaction.findMany({ where: { ...incomeExpenseWhere, type: "income" }, select: { amount: true, baseAmount: true } }),
    this.prisma.transaction.findMany({ where: { ...incomeExpenseWhere, type: "expense" }, select: { amount: true, baseAmount: true } }),
    this.prisma.transaction.findMany({
      where: investmentWhere,
      select: {
        amount: true,
        investmentAsset: { select: { id: true, name: true } },
      },
    }),
  ]);

  const totalIncome = sumBaseOrAmount(incomeRows);
  const totalExpenses = sumBaseOrAmount(expenseRows);
```

Ajustar el test del Step 1 (segundo caso) para que mockee `findMany` en vez de `aggregate` con filas `[{ amount: 1000, baseAmount: 950 }]`/`[{ amount: 400, baseAmount: 380 }]`, y comprobar `totalIncome === 950`/`totalExpenses === 380`. Dejar el primer test (`findMany` con filas `{ amount, baseAmount: null }`) verificando `totalIncome === 1000` (usa `amount` cuando `baseAmount` es `null`, comportamiento idéntico al actual).

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest dashboard.service -v`
Expected: PASS.

- [ ] **Step 5: Aplicar el mismo patrón a `getByCategory` y `getTrends`**

En ambos métodos de `dashboard.service.ts`, sustituir el `groupBy({ by: [...], _sum: { amount: true } })` por `findMany` con `select: { <campo agrupador>: true, amount: true, baseAmount: true }`, agrupar manualmente con un `Map`, y sumar con la misma función `sumBaseOrAmount` (o su variante sin `Math.abs` para `getTrends`, que no usa valor absoluto hoy — revisar el código actual línea por línea antes de tocar, para no cambiar el signo de nada).

- [ ] **Step 6: Compilar y ejecutar toda la suite de `dashboard`**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json && npx jest dashboard -v`
Expected: sin errores, todos los tests en verde.

- [ ] **Step 7: Commit**

```bash
cd spendly-backend
git add src/modules/dashboard/dashboard.service.ts src/modules/dashboard/dashboard.service.spec.ts
git commit -m "feat(dashboard): estadisticas suman baseAmount cuando existe, amount si no (EUR sin cambios)"
```

### Task 10: `Budget.currency` + gasto convertido

**Files:**
- Modify: `spendly-backend/src/modules/budgets/dto/create-budget.dto.ts`
- Modify: `spendly-backend/src/modules/budgets/budgets.service.ts`
- Modify: `spendly-backend/src/modules/budgets/budgets.module.ts`
- Test: `spendly-backend/src/modules/budgets/budgets.service.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `CurrencyService.convert(amount, from, to, date)` (Task 4).
- Produces: `computeBudgetProgress` sigue devolviendo la misma forma de objeto, con `totalSpentRaw`/`spent` ya en `Budget.currency`.

- [ ] **Step 1: Añadir `currency` al DTO**

En `create-budget.dto.ts`, después de `totalLimit`:

```ts
  @IsOptional()
  @IsNumber()
  @IsPositive()
  totalLimit?: number | null;

  // ISO 4217. Si no se manda, el service la rellena con la moneda base del
  // usuario. Todos los importes de este presupuesto (limite y gasto) se
  // comparan en esta moneda, sin importar la moneda de cada cartera incluida.
  @IsOptional()
  @IsString()
  currency?: string;
```

- [ ] **Step 2: Escribir el test de `computeBudgetProgress` con monedas mezcladas**

```ts
// spendly-backend/src/modules/budgets/budgets.service.spec.ts
import { BudgetsService } from './budgets.service';

describe('BudgetsService — gasto convertido a Budget.currency', () => {
  function build(rows: Array<{ amount: number; currency: string; date: Date }>) {
    const prisma: any = {
      transaction: { findMany: jest.fn().mockResolvedValue(rows) },
    };
    const currency: any = {
      convert: jest.fn(async (amount: number, from: string, to: string) => ({
        toNumber: () => (from === to ? amount : amount * 0.9393),
      })),
    };
    const service: any = new BudgetsService(prisma, {} as any, currency);
    return { service, prisma, currency };
  }

  it('todas las transacciones en la moneda del budget: no llama a CurrencyService', async () => {
    const { service, currency } = build([{ amount: 30, currency: 'EUR', date: new Date('2026-09-01') }]);
    const budget: any = { id: 1, currency: 'EUR', totalLimit: 100, carryOverRemaining: false, categoryLimits: [], walletIds: [], startDate: new Date('2026-09-01') };

    const progress = await service['computeBudgetProgress'](7, budget, { from: new Date('2026-09-01'), to: new Date('2026-09-30') }, { from: new Date('2026-08-01'), to: new Date('2026-08-31') });

    expect(progress.globalSpent).toBe(30);
    expect(currency.convert).not.toHaveBeenCalled();
  });

  it('una transaccion en otra moneda: se convierte a Budget.currency antes de sumar', async () => {
    const { service, currency } = build([
      { amount: 30, currency: 'EUR', date: new Date('2026-09-01') },
      { amount: 50, currency: 'CHF', date: new Date('2026-09-02') },
    ]);
    const budget: any = { id: 1, currency: 'EUR', totalLimit: 100, carryOverRemaining: false, categoryLimits: [], walletIds: [], startDate: new Date('2026-09-01') };

    const progress = await service['computeBudgetProgress'](7, budget, { from: new Date('2026-09-01'), to: new Date('2026-09-30') }, { from: new Date('2026-08-01'), to: new Date('2026-08-31') });

    expect(currency.convert).toHaveBeenCalledWith(50, 'CHF', 'EUR', new Date('2026-09-02'));
    expect(progress.globalSpent).toBeCloseTo(30 + 50 * 0.9393, 2);
  });
});
```

- [ ] **Step 3: Ejecutar el test y comprobar que falla**

Run: `cd spendly-backend && npx jest budgets.service -v`
Expected: FAIL — `BudgetsService` no acepta `currency` como 3er argumento / `computeBudgetProgress` no convierte.

- [ ] **Step 4: Inyectar `CurrencyService` y sustituir los `aggregate` por conversión fila a fila**

Modify `spendly-backend/src/modules/budgets/budgets.service.ts`: añadir `import { CurrencyService } from '../currency/currency.service';`, añadir `private currency: CurrencyService` al `constructor`, y añadir un helper privado:

```ts
  // Suma `rows` ya convertidas a `targetCurrency`. Si una fila ya está en esa
  // moneda no llama a CurrencyService (caso normal hoy: todo EUR, coste cero).
  private async sumConverted(rows: Array<{ amount: number; currency: string; date: Date }>, targetCurrency: string): Promise<number> {
    let total = 0;
    for (const row of rows) {
      if (row.currency === targetCurrency) {
        total += row.amount;
      } else {
        const converted = await this.currency.convert(row.amount, row.currency, targetCurrency, row.date);
        total += converted.toNumber();
      }
    }
    return total;
  }
```

Sustituir, dentro de `computeBudgetProgress`, cada `this.prisma.transaction.aggregate({ where: ..., _sum: { amount: true } })` por `this.prisma.transaction.findMany({ where: ..., select: { amount: true, currency: true, date: true } })` seguido de `await this.sumConverted(rows, b.currency)`. Hay tres sitios: el `totalAgg` (línea ~195), el `agg` dentro del `for (const cl of b.categoryLimits)` (línea ~202), y el `prevAgg` del carry-over (línea ~227). Sustituir `totalAgg._sum.amount ?? 0` por el resultado de `sumConverted`, y lo mismo para los otros dos.

- [ ] **Step 5: Actualizar `BudgetsModule`**

Modify `spendly-backend/src/modules/budgets/budgets.module.ts`: añadir `import { CurrencyModule } from '../currency/currency.module';` y `CurrencyModule` a `imports`.

- [ ] **Step 6: Ejecutar el test y comprobar que pasa**

Run: `cd spendly-backend && npx jest budgets.service -v`
Expected: PASS.

- [ ] **Step 7: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
cd spendly-backend
git add src/modules/budgets/dto/create-budget.dto.ts src/modules/budgets/budgets.service.ts src/modules/budgets/budgets.module.ts src/modules/budgets/budgets.service.spec.ts
git commit -m "feat(budgets): Budget.currency + gasto convertido a esa moneda antes de comparar con el limite"
```

---

## Fase 5 — Trips, Debts, Investments

### Task 11: `Trip.currency` + fix del sumatorio de coste por moneda

**Files:**
- Modify: `spendly-backend/src/modules/trips/dto/create-trip.dto.ts`
- Modify: `spendly-backend/src/modules/trips/trips.service.ts`
- Modify: `spendly-backend/src/modules/trips/trips.module.ts`
- Test: `spendly-backend/src/modules/trips/trip-cost.spec.ts` (nuevo — cubre solo la función pura extraída, no todo `trips.service.ts`)

**Interfaces:**
- Consumes: `CurrencyService.convert` (Task 4).
- Produces: `Trip.currency`; el recálculo de `trip.cost` (hoy en `trips.service.ts` alrededor de la línea 510, dentro del método que suma `planItems`) usa esta lógica.

- [ ] **Step 1: Leer el método completo antes de tocarlo**

Run: `cd spendly-backend && sed -n '480,535p' src/modules/trips/trips.service.ts`
Anotar el nombre exacto del método que contiene la línea `return total + Number(item.cost || 0);` y su firma completa (parámetros, tipo de retorno) — no está fijado en este plan porque no se leyó el método completo durante el diseño; confirmarlo aquí antes de escribir el Step 3.

- [ ] **Step 2: Añadir `currency` al DTO**

En `create-trip.dto.ts`, después de `cost`:

```ts
  @IsOptional()
  @IsNumber()
  cost?: number;

  // ISO 4217, moneda "hogar" del viaje para cost/budget. Por defecto la
  // moneda base del usuario.
  @IsOptional()
  @IsString()
  currency?: string;
```

(añadir `IsString` al import de `class-validator` si no está ya — sí lo está, se usa en otros campos del mismo archivo).

- [ ] **Step 3: Extraer y corregir el sumatorio de coste a una función pura testeable**

Crear `spendly-backend/src/modules/trips/trip-cost.ts`:

```ts
// spendly-backend/src/modules/trips/trip-cost.ts
import { CurrencyService } from '../currency/currency.service';

export type PlanItemCost = { cost: number | null; currency: string | null; day?: Date | null };

// Suma el coste de los plan items de un viaje, convirtiendo cada uno a
// `tripCurrency` cuando su propia currency difiere (tipo historico, fecha del
// item). Antes de esta funcion, trips.service.ts sumaba item.cost en crudo
// ignorando item.currency — bug latente ya presente si algun dia hay items en
// monedas distintas, corregido aqui de paso.
export async function sumPlanItemsCost(
  items: PlanItemCost[],
  tripCurrency: string,
  currencyService: Pick<CurrencyService, 'convert'>,
): Promise<number> {
  let total = 0;
  for (const item of items) {
    const cost = Number(item.cost ?? 0);
    if (!cost) continue;
    const itemCurrency = item.currency ?? tripCurrency;
    if (itemCurrency === tripCurrency) {
      total += cost;
    } else {
      const converted = await currencyService.convert(cost, itemCurrency, tripCurrency, item.day ?? undefined);
      total += converted.toNumber();
    }
  }
  return total;
}
```

- [ ] **Step 4: Escribir el test de `sumPlanItemsCost`**

```ts
// spendly-backend/src/modules/trips/trip-cost.spec.ts
import { sumPlanItemsCost } from './trip-cost';

describe('sumPlanItemsCost', () => {
  it('todos los items en la moneda del viaje: suma directa', async () => {
    const currencyService = { convert: jest.fn() } as any;
    const total = await sumPlanItemsCost(
      [{ cost: 100, currency: 'EUR' }, { cost: 50, currency: null }],
      'EUR',
      currencyService,
    );
    expect(total).toBe(150);
    expect(currencyService.convert).not.toHaveBeenCalled();
  });

  it('un item en otra moneda: se convierte con el tipo historico de su dia', async () => {
    const day = new Date('2026-09-01');
    const currencyService = { convert: jest.fn().mockResolvedValue({ toNumber: () => 46.5 }) } as any;
    const total = await sumPlanItemsCost([{ cost: 100, currency: 'EUR' }, { cost: 50, currency: 'CHF', day }], 'EUR', currencyService);
    expect(currencyService.convert).toHaveBeenCalledWith(50, 'CHF', 'EUR', day);
    expect(total).toBe(146.5);
  });

  it('ignora items sin coste', async () => {
    const currencyService = { convert: jest.fn() } as any;
    const total = await sumPlanItemsCost([{ cost: null, currency: 'EUR' }], 'EUR', currencyService);
    expect(total).toBe(0);
  });
});
```

- [ ] **Step 5: Ejecutar el test y comprobar que pasa (ya es TDD válido: la función es nueva, no hace falta verla fallar por falta de implementación — comprobar que sí falla si se borra el cuerpo de la función es suficiente)**

Run: `cd spendly-backend && npx jest trip-cost -v`
Expected: PASS — 3 tests.

- [ ] **Step 6: Sustituir el sumatorio en `trips.service.ts` por `sumPlanItemsCost`**

Usando el nombre de método confirmado en el Step 1, sustituir el `.reduce((total, item) => total + Number(item.cost || 0), 0)` (o equivalente) por `await sumPlanItemsCost(planItems, trip.currency ?? 'EUR', this.currency)`. Añadir `CurrencyService` al `constructor` de `TripsService` (import `from '../currency/currency.service'`) y `import { sumPlanItemsCost } from './trip-cost';`.

- [ ] **Step 7: Actualizar `TripsModule`**

Modify `spendly-backend/src/modules/trips/trips.module.ts`: añadir `import { CurrencyModule } from '../currency/currency.module';` y `CurrencyModule` a `imports`.

- [ ] **Step 8: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
cd spendly-backend
git add src/modules/trips/dto/create-trip.dto.ts src/modules/trips/trips.service.ts src/modules/trips/trips.module.ts src/modules/trips/trip-cost.ts src/modules/trips/trip-cost.spec.ts
git commit -m "feat(trips): Trip.currency + coste de plan items convertido por moneda (antes se ignoraba)"
```

### Task 12: `Debt.currency`

**Files:**
- Modify: `spendly-backend/src/modules/debts/dto/create-debt.dto.ts`
- Modify: `spendly-backend/src/modules/debts/debts.service.ts`

**Interfaces:**
- No consume `CurrencyService` — las deudas no entran en patrimonio ni estadísticas globales hoy (confirmado en el diseño, sección 11).

- [ ] **Step 1: Añadir `currency` opcional al DTO**

En `create-debt.dto.ts`, después de `totalAmount`:

```ts
  @IsNumber()
  totalAmount: number;

  // ISO 4217. Si no se manda y hay walletId, hereda la moneda de esa cartera;
  // si no, la moneda base del usuario (se resuelve en el service).
  @IsOptional()
  @IsString()
  currency?: string;
```

- [ ] **Step 2: Rellenar `currency` al crear, heredando de la cartera**

En `debts.service.ts`, dentro de `async create(userId: number, dto: CreateDebtDto)`, antes de `const debt = await this.prisma.debt.create({` (línea ~160), añadir:

```ts
    let currency = dto.currency;
    if (!currency) {
      if (dto.walletId != null) {
        const wallet = await this.prisma.wallet.findUnique({ where: { id: dto.walletId }, select: { currency: true } });
        currency = wallet?.currency;
      }
      if (!currency) {
        const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } });
        currency = user?.currency ?? 'EUR';
      }
    }
```

Y añadir `currency,` dentro del objeto `data` de `this.prisma.debt.create`.

- [ ] **Step 3: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
cd spendly-backend
git add src/modules/debts/dto/create-debt.dto.ts src/modules/debts/debts.service.ts
git commit -m "feat(debts): Debt.currency, heredada de la cartera vinculada o de la moneda base"
```

### Task 13: Inversiones — totales consolidados en la moneda base

**Files:**
- Modify: `spendly-backend/src/modules/investments/investments.service.ts`
- Modify: `spendly-backend/src/modules/investments/investments.module.ts`
- Test: `spendly-backend/src/modules/investments/investment-currency-totals.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `CurrencyService.convertToBase` (Task 4).
- No cambia `investmentReturn.ts` (rentabilidad por activo, en su propia moneda) — solo los totales agregados de `getSummary`.

- [ ] **Step 1: Leer el resto de `getSummary` antes de tocarlo**

Run: `cd spendly-backend && sed -n '744,800p' src/modules/investments/investments.service.ts`
Confirmar el nombre exacto de las variables `totalContributed`/`totalWithdrawn`/`totalCurrentValue`/`totalPnL` y cómo se construye el objeto de retorno, antes de escribir el Step 3 (ya se vio parcialmente durante el diseño: `perAsset.reduce((acc, x) => acc + x.totalContributed, 0)` en la línea ~767 — confirmar el resto).

- [ ] **Step 2: Escribir el test de la función de agregación**

```ts
// spendly-backend/src/modules/investments/investment-currency-totals.spec.ts
import { sumInBaseCurrency } from './investment-currency-totals';

describe('sumInBaseCurrency', () => {
  it('todos los activos en la moneda base: suma directa', async () => {
    const currencyService = { getCurrentRate: jest.fn() } as any;
    const total = await sumInBaseCurrency([{ value: 100, currency: 'EUR' }, { value: 50, currency: 'EUR' }], 'EUR', currencyService);
    expect(total).toBe(150);
    expect(currencyService.getCurrentRate).not.toHaveBeenCalled();
  });

  it('un activo en otra moneda: convierte al tipo actual', async () => {
    const currencyService = { getCurrentRate: jest.fn().mockResolvedValue({ toNumber: () => 0.9393 }) } as any;
    const total = await sumInBaseCurrency([{ value: 100, currency: 'EUR' }, { value: 1000, currency: 'USD' }], 'EUR', currencyService);
    expect(currencyService.getCurrentRate).toHaveBeenCalledWith('USD', 'EUR');
    expect(total).toBeCloseTo(100 + 1000 * 0.9393, 2);
  });
});
```

- [ ] **Step 3: Extraer `sumInBaseCurrency` y usarla en `getSummary`**

Crear `spendly-backend/src/modules/investments/investment-currency-totals.ts`:

```ts
// spendly-backend/src/modules/investments/investment-currency-totals.ts
import { CurrencyService } from '../currency/currency.service';

export type ValueInCurrency = { value: number; currency: string };

// Suma valores de activos que pueden estar en distintas monedas, convirtiendo
// cada uno a `baseCurrency` con el tipo ACTUAL (no histórico: es un total de
// patrimonio vivo, igual que el saldo de una Wallet). No mezcla esto con la
// rentabilidad de cada activo, que sigue calculándose en su propia moneda.
export async function sumInBaseCurrency(
  items: ValueInCurrency[],
  baseCurrency: string,
  currencyService: Pick<CurrencyService, 'getCurrentRate'>,
): Promise<number> {
  let total = 0;
  for (const item of items) {
    if (item.currency === baseCurrency) {
      total += item.value;
    } else {
      const rate = await currencyService.getCurrentRate(item.currency, baseCurrency);
      total += rate.toNumber() * item.value;
    }
  }
  return total;
}
```

En `investments.service.ts`, usando los nombres confirmados en el Step 1, sustituir los `perAsset.reduce((acc, x) => acc + x.totalCurrentValue, 0)` (y equivalentes para `totalContributed`/`totalWithdrawn`/`totalPnL` si también difieren por activo) por `await sumInBaseCurrency(perAsset.map(x => ({ value: x.totalCurrentValue, currency: x.currency })), baseCurrency, this.currency)`, obteniendo `baseCurrency` de `this.prisma.user.findUnique({ where: { id: userId }, select: { currency: true } })` al principio de `getSummary`. Añadir `CurrencyService` al `constructor` de `InvestmentsService` (import `from '../currency/currency.service'`) y `import { sumInBaseCurrency } from './investment-currency-totals';`.

- [ ] **Step 4: Ejecutar los tests y comprobar que pasan**

Run: `cd spendly-backend && npx jest investment-currency-totals investments.service -v`
Expected: PASS.

- [ ] **Step 5: Actualizar `InvestmentsModule`**

Modify `spendly-backend/src/modules/investments/investments.module.ts`: añadir `import { CurrencyModule } from '../currency/currency.module';` y `CurrencyModule` a `imports`.

- [ ] **Step 6: Compilar**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
cd spendly-backend
git add src/modules/investments/investment-currency-totals.ts src/modules/investments/investment-currency-totals.spec.ts src/modules/investments/investments.service.ts src/modules/investments/investments.module.ts
git commit -m "feat(investments): totales consolidados convierten cada activo a la moneda base (tipo actual)"
```

---

## Fase 6 — Frontend: formatCurrency, selectores, Settings

### Task 14: `formatCurrency` centralizado

**Files:**
- Modify: `spendly/src/utils/currency.ts`
- Test: `spendly/src/utils/currency.test.ts` (nuevo, Vitest)

**Interfaces:**
- Produces: `formatCurrency(amount: number, currency: string, locale?: string): string`. `formatEuro` pasa a ser un wrapper (`formatEuro(n) = formatCurrency(n, 'EUR')`), sin cambiar su firma ni su comportamiento — los ~82 archivos que ya la usan siguen funcionando sin tocarlos.

- [ ] **Step 1: Escribir el test**

```ts
// spendly/src/utils/currency.test.ts
import { describe, it, expect } from 'vitest';
import { formatCurrency, formatEuro } from './currency';

describe('formatCurrency', () => {
  it('EUR con 2 decimales, coma decimal, punto de miles', () => {
    expect(formatCurrency(1234.5, 'EUR')).toBe('1.234,50 €');
  });

  it('USD con simbolo $', () => {
    expect(formatCurrency(20.5, 'USD')).toBe('20,50 $');
  });

  it('CHF sin simbolo unico: muestra el codigo', () => {
    expect(formatCurrency(15.5, 'CHF')).toContain('CHF');
    expect(formatCurrency(15.5, 'CHF')).toContain('15,50');
  });

  it('JPY sin decimales', () => {
    expect(formatCurrency(1500, 'JPY')).toBe('1.500 ¥');
  });

  it('GBP con simbolo £', () => {
    expect(formatCurrency(8.99, 'GBP')).toBe('8,99 £');
  });

  it('negativo mantiene el signo', () => {
    expect(formatCurrency(-20.5, 'USD')).toContain('-');
  });
});

describe('formatEuro (wrapper de formatCurrency)', () => {
  it('sigue devolviendo el mismo formato de siempre, sin simbolo', () => {
    expect(formatEuro(1234.5)).toBe('1.234,50');
  });
});
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd spendly && npx vitest run currency.test`
Expected: FAIL — `formatCurrency` no existe.

- [ ] **Step 3: Implementar `formatCurrency`, dejando `formatEuro` intacta por fuera**

En `spendly/src/utils/currency.ts`, añadir al principio del archivo (antes de `formatEuro`):

```ts
// Formato de moneda genérico, para cualquier ISO 4217. Usa Intl.NumberFormat
// (disponible en Hermes/RN moderno para números, a diferencia del agrupador
// de miles de toLocaleString que formatEuro evita por otros motivos — ver
// comentario de formatEuro más abajo). Símbolo detrás del número, con espacio,
// igual que el resto de la UI ("1.234,50 €", nunca "€1.234,50").
export function formatCurrency(amount: number, currency: string, locale = 'es-ES'): string {
  if (!Number.isFinite(amount)) amount = 0;
  const parts = new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(amount);
  const symbol = parts.find((p) => p.type === 'currency')?.value ?? currency;
  const number = parts
    .filter((p) => p.type !== 'currency' && p.type !== 'literal')
    .map((p) => p.value)
    .join('')
    .trim();
  return `${number} ${symbol}`;
}
```

Y sustituir la implementación de `formatEuro` (dejando su firma y todo lo demás del archivo igual) por:

```ts
export function formatEuro(n: number): string {
  if (!Number.isFinite(n)) return "0,00";
  const abs = Math.abs(n).toFixed(2);
  const sign = n < 0 && Number(abs) !== 0 ? "-" : "";
  const [intPart, decPart] = abs.split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${grouped},${decPart}`;
}
```

(sin cambios reales — se deja explícito en este step para que quede claro que NO pasa a delegar en `formatCurrency`: `formatCurrency('EUR')` añade el símbolo `€`, y `formatEuro` históricamente NO lo lleva — lo añaden los call-sites con `` `${formatEuro(x)} €` ``. Delegar rompería esos ~82 call-sites. El test de "formatEuro (wrapper)" del Step 1 verifica el comportamiento resultante, no la implementación interna.)

- [ ] **Step 4: Ejecutar el test y comprobar que pasa**

Run: `cd spendly && npx vitest run currency.test`
Expected: PASS — 7 tests. Si `Intl.NumberFormat` con `currencyDisplay: 'narrowSymbol'` da un resultado distinto al esperado para alguna moneda en el entorno de test (Node, no Hermes), ajustar las aserciones del test a lo que realmente produzca `Intl` en Node para esa `locale`/`currency` — no forzar el formateador a mano para igualar un valor supuesto.

- [ ] **Step 5: Commit**

```bash
cd spendly
git add src/utils/currency.ts src/utils/currency.test.ts
git commit -m "feat(currency): formatCurrency basado en Intl.NumberFormat, formatEuro como wrapper sin cambios"
```

### Task 15: Selector de moneda en formularios de Wallet/Goal/Budget/Trip

**Files:**
- Modify: `spendly/src/components/EditWalletModal.tsx`
- Modify: `spendly/src/screens/Mobile/finances/goals/GoalFormScreen.tsx`
- Modify: `spendly/src/screens/Mobile/finances/budgets/BudgetCreateScreen.tsx`
- Modify: `spendly/src/screens/Mobile/finances/travels/TravelFormScreen.tsx`

**Interfaces:**
- Consumes: `CurrencyPickerModal`/`currencySymbol` (ya existen, `spendly/src/components/CurrencyPickerModal.tsx`), `user.currency` del contexto de auth (`useAuth()`, ya usado en `App.tsx`) como valor por defecto.

- [ ] **Step 1: Leer cada pantalla antes de tocarla**

Run (uno por archivo, antes de editar):
```bash
cd spendly
grep -n "currency\|Wallet\|const \[.*State" src/components/EditWalletModal.tsx | head -30
grep -n "currency\|const \[.*State" src/screens/Mobile/finances/goals/GoalFormScreen.tsx | head -30
grep -n "currency\|const \[.*State" src/screens/Mobile/finances/budgets/BudgetCreateScreen.tsx | head -30
grep -n "currency\|const \[.*State" src/screens/Mobile/finances/travels/TravelFormScreen.tsx | head -30
```

`EditWalletModal.tsx` y `GoalFormScreen.tsx` es muy probable que ya tengan algo de selección de moneda (Wallet y Goal ya tienen `currency` en el schema desde antes de este proyecto) — si ya existe un selector, esta tarea es solo confirmarlo y, si usa una lista de monedas distinta a `CurrencyPickerModal`/`COMMON_CURRENCIES`, dejarlo igual (no tocar lo que ya funciona) y anotarlo en el resumen final. Si NO existe selector en alguno de los cuatro, añadirlo con el mismo patrón ya usado en `AddTransactionScreen.tsx` (Task de la sesión anterior: botón que abre `CurrencyPickerModal`, `value={currency}`, `onSelect={setCurrency}`, valor inicial `user?.currency ?? 'EUR'`).

- [ ] **Step 2: Para cada pantalla sin selector, añadirlo**

Patrón exacto (ya usado en `spendly/src/screens/Mobile/addTransaction/AddTransactionScreen.tsx`, sesión anterior de este proyecto):

```tsx
import CurrencyPickerModal, { currencySymbol } from "../../../components/CurrencyPickerModal"; // ajustar ruta relativa
// ...
const [currency, setCurrency] = useState<string>(existingItem?.currency ?? user?.currency ?? "EUR");
const [currencyModalOpen, setCurrencyModalOpen] = useState(false);
// ...
<TouchableOpacity onPress={() => setCurrencyModalOpen(true)}>
  <Text>{currencySymbol(currency)} {currency}</Text>
</TouchableOpacity>
<CurrencyPickerModal
  visible={currencyModalOpen}
  value={currency}
  onSelect={setCurrency}
  onClose={() => setCurrencyModalOpen(false)}
/>
```

Y en el payload de guardado de cada formulario, incluir `currency` (mismo nombre de campo que ya usa cada DTO backend: `currency` en los cuatro casos).

- [ ] **Step 3: Comprobar tipos**

Run: `cd spendly && npx tsc --noEmit -p .`
Expected: sin errores nuevos.

- [ ] **Step 4: Commit**

```bash
cd spendly
git add src/components/EditWalletModal.tsx src/screens/Mobile/finances/goals/GoalFormScreen.tsx src/screens/Mobile/finances/budgets/BudgetCreateScreen.tsx src/screens/Mobile/finances/travels/TravelFormScreen.tsx
git commit -m "feat(forms): selector de moneda (CurrencyPickerModal) en Wallet/Goal/Budget/Trip donde faltaba"
```

### Task 16: Settings — "Moneda principal"

**Files:**
- Modify: `spendly-backend/src/modules/users/dto/update-profile.dto.ts`
- Modify: `spendly/src/screens/Mobile/profile/AccountScreen.tsx`

**Interfaces:**
- Consumes: `PATCH /users/me` (ya existe, `spendly-backend/src/modules/users/user.controller.ts:20`), `CurrencyPickerModal`.
- Produces: `UpdateProfileDto` acepta `currency?: string`; `AccountScreen.tsx` gana una fila "Moneda principal".

- [ ] **Step 1: Añadir `currency` al DTO del backend**

En `spendly-backend/src/modules/users/dto/update-profile.dto.ts`, añadir:

```ts
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency debe ser un código ISO 4217 de 3 letras' })
  currency?: string;
```

(añadir `Matches` al import de `class-validator`).

- [ ] **Step 2: Comprobar que `updateProfile` del service ya acepta el campo sin cambios**

Run: `cd spendly-backend && grep -n "updateProfile" src/modules/users/user.service.ts`
Si el método hace `this.prisma.user.update({ where: { id }, data: dto })` (spread genérico), no hace falta tocar nada más — `currency` pasa igual que `name`/`avatar`. Si en cambio desestructura campos explícitos, añadir `currency` a esa lista.

- [ ] **Step 3: Leer `AccountScreen.tsx` para ubicar dónde añadir la fila**

Run: `cd spendly && grep -n "PATCH\|updateProfile\|/users/me\|TouchableOpacity\|Section" src/screens/Mobile/profile/AccountScreen.tsx | head -30`

- [ ] **Step 4: Añadir la fila "Moneda principal"**

Usando el mismo patrón visual que las filas ya existentes de esa pantalla (nombre/avatar), añadir un `TouchableOpacity` que abra `CurrencyPickerModal` con `value={user?.currency ?? 'EUR'}`, y en `onSelect`, llamar al mismo endpoint que ya usa la pantalla para guardar perfil (`api.patch('/users/me', { currency })`), seguido de refrescar el usuario en el contexto de auth (mismo mecanismo que ya usa esa pantalla tras guardar nombre/avatar — no inventar uno nuevo).

- [ ] **Step 5: Comprobar tipos**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json && cd ../spendly && npx tsc --noEmit -p .`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
cd spendly-backend && git add src/modules/users/dto/update-profile.dto.ts && git commit -m "feat(users): PATCH /users/me acepta currency (moneda base)"
cd ../spendly && git add src/screens/Mobile/profile/AccountScreen.tsx && git commit -m "feat(settings): fila Moneda principal con CurrencyPickerModal"
```

---

## Fase 7 — Apple Wallet, verificación final

### Task 17: El flujo Wallet envía `currency` al crear la transacción

**Files:**
- Modify: `spendly/src/screens/Mobile/addTransaction/AddTransactionScreen.tsx`
- Modify: `spendly/src/components/CreateTransactionModal.tsx`

**Interfaces:**
- Consumes: el estado `currency` que ya existe en ambos componentes desde la sesión anterior (selector visual, sin enviarse todavía) y el campo `Transaction.currency` del payload (Task 6).

- [ ] **Step 1: Confirmar el estado actual**

Run: `cd spendly && grep -n "currency" src/screens/Mobile/addTransaction/AddTransactionScreen.tsx src/components/CreateTransactionModal.tsx`
Confirmar que `currency`/`setCurrency` existen (de la sesión anterior) pero no aparecen en la construcción de `payload` de `handleSubmit`.

- [ ] **Step 2: Añadir `currency` al payload en `AddTransactionScreen.tsx`**

En el `handleSubmit`, dentro del objeto `payload` (junto a `type`, `amount`, `description`, `date`), añadir:

```ts
      currency,
```

- [ ] **Step 3: Añadir `currency` al payload en `CreateTransactionModal.tsx`**

Mismo cambio, en la construcción del payload de creación de ese componente.

- [ ] **Step 4: Comprobar tipos**

Run: `cd spendly && npx tsc --noEmit -p .`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
cd spendly
git add src/screens/Mobile/addTransaction/AddTransactionScreen.tsx src/components/CreateTransactionModal.tsx
git commit -m "feat(quick-add): envia la moneda seleccionada al crear la transaccion (antes solo era visual)"
```

### Task 18: Verificación final

**Files:** ninguno nuevo — solo ejecución.

- [ ] **Step 1: Suite completa del backend**

Run: `cd spendly-backend && npx jest -v`
Expected: todos los tests en verde, incluidos los ~19 de `currency/`, los nuevos de `dashboard`, `budgets`, `trips`, `investments`, `transactions`, y los que ya existían antes de este plan (`category-suggestion`, `goals`, etc.).

- [ ] **Step 2: Typecheck backend**

Run: `cd spendly-backend && npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 3: Suite completa del frontend**

Run: `cd spendly && npx vitest run`
Expected: todos los tests en verde, incluidos `walletAmount.test.ts` (ya existente) y `currency.test.ts` (Task 14).

- [ ] **Step 4: Typecheck frontend**

Run: `cd spendly && npx tsc --noEmit -p .`
Expected: sin errores.

- [ ] **Step 5: Lint (si hay script configurado)**

Run: `cd spendly-backend && npm run lint 2>&1 | tail -40` y `cd spendly && npx eslint . 2>&1 | tail -40` (o el comando equivalente que exponga cada `package.json` — comprobar el script exacto antes de ejecutar).
Expected: sin errores nuevos introducidos por este plan (los preexistentes, si los hay, no son responsabilidad de esta entrega).

- [ ] **Step 6: `prisma db push` final (si no se hizo ya en Task 1, o para confirmar que sigue sincronizado)**

Run: `cd spendly-backend && npx prisma db push`
Expected: "The database is now in sync with your Prisma schema" sin cambios pendientes.

- [ ] **Step 7: Reportar al usuario**

No hay commit en este paso — es el resumen final que exige el encargo original: archivos modificados por fase, migraciones aplicadas, cómo funciona `CurrencyService`, qué endpoints/pantallas cambiaron, y las limitaciones explícitas ya identificadas durante el diseño y este plan:
- `wealthSeries`/serie histórica de patrimonio (Task 8) sigue sin convertir — solo el patrimonio actual (`current`) se corrigió.
- Migrar `Float` → `Decimal` en campos de dinero existentes queda fuera.
- Separar rentabilidad de activo vs efecto FX en inversiones queda fuera.
- `accountAmount`/`accountCurrency` quedan preparados en el modelo sin ningún proveedor real de Open Banking detrás.

---

## Autorrevisión del plan (hecha antes de entregarlo)

- **Cobertura del spec:** las 17 secciones numeradas del encargo original tienen tarea — moneda base (Task 1, reutiliza `User.currency`), moneda por entidad (Tasks 1, 11, 12), Decimal (Task 1, alcance ya decidido), CurrencyService (Task 4), provider (Tasks 2-3), ExchangeRate/cache (Tasks 1, 4-5), cron (Task 5), histórico vs actual (Task 4, aplicado en Tasks 6/9/10/11/13), Transaction original (Task 6), prioridad importe banco (Task 6, campos preparados), patrimonio (Tasks 7-8), estadísticas (Task 9), cambio de moneda base (Task 16, sin recálculo destructivo — nada en el plan reescribe transacciones al cambiarla), Goals/GoalAllocation (ya cumplido, sin tarea nueva, verificado en el diseño), Investments (Task 13), Apple Wallet (Task 17, el parser ya cumplía, solo faltaba enviar el campo), Frontend (Tasks 14-16), migración (Task 1), tests (en cada tarea + Task 18).
- **Placeholders:** ninguno de los "no implementar" (`TBD`, "similar a la tarea N" sin código, "añadir validación apropiada") aparece en este plan; los dos únicos puntos abiertos (Task 11 Step 1, Task 13 Step 1) son lecturas explícitas de código real antes de escribir el diff, con el comando exacto a ejecutar — no son ambigüedad de qué hacer, sino confirmación del nombre exacto de una función ya localizada por línea.
- **Consistencia de tipos:** `CurrencyService.convert`/`getCurrentRate`/`getHistoricalRate` devuelven `Prisma.Decimal` en todas las tareas que los consumen (6, 7, 9 vía `baseAmount` ya persistido, 10, 11, 13) — mismo tipo en todos los mocks de test. `sumConverted`/`sumPlanItemsCost`/`sumInBaseCurrency` son tres funciones distintas a propósito (cada una con su regla histórico/actual y su forma de fila de entrada), no una sola reutilizada mal — está documentado en cada una por qué no comparten código.
