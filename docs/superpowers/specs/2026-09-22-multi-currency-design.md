# Finexa multi-currency — diseño

Fecha: 2026-09-22
Repos afectados: `spendly-backend` (principal) y `spendly` (frontend)
Estado: aprobado por el usuario en chat el 2026-09-22, pendiente de plan de implementación

## Contexto

Finexa es hoy EUR-only en la práctica: `Wallet.currency`, `Goal.currency`,
`InvestmentAsset.currency` y `InvestmentValuationSnapshot.currency` ya existen
en el schema pero casi todo el resto (`Transaction.amount`, agregaciones de
`dashboard`, `budgets`, `reports`, y el `€` literal en ~82 archivos del
frontend) asume EUR de forma implícita.

Objetivo: soportar varias monedas de forma sólida, sin romper lo que ya
funciona y sin convertir importes originales de forma destructiva.

## Decisiones ya tomadas (no reabrir sin motivo)

1. **Moneda base del usuario:** se reutiliza `User.currency` (existe, default
   `"EUR"`, no se usa en ningún sitio hoy). No se crea `User.baseCurrency`.
2. **Precisión:** los campos `Float` existentes que representan dinero
   (`Wallet.balance`, `Transaction.amount`, `Debt.*`, `InvestmentOperation.amount`,
   `Trip.cost`/`budget`, límites de `Budget`) **no se migran a Decimal en esta
   entrega**. Los campos nuevos de FX sí son `Decimal`. Migrar los `Float`
   existentes queda como proyecto aparte, explícitamente fuera de alcance.
3. **Budget con varias carteras:** `Budget` puede seguir aplicando a varias
   `walletIds` de monedas distintas. Se le añade `Budget.currency`; el gasto de
   cada transacción se convierte a esa moneda (tipo histórico) antes de sumar.
4. **Entrega:** un solo diseño, implementación en etapas con checkpoints (ver
   "Orden de implementación").

## 1. Modelo de datos

### Campos nuevos

```prisma
model Transaction {
  // ...existentes sin cambios...
  currency        String   @default("EUR")
  baseAmount      Decimal? @db.Decimal(14, 4)
  exchangeRate    Decimal? @db.Decimal(18, 8)
  accountAmount   Decimal? @db.Decimal(14, 4)
  accountCurrency String?
}

model Budget {
  // ...existentes sin cambios...
  currency String @default("EUR")
}

model Trip {
  // ...existentes sin cambios...
  currency String @default("EUR")
}

model Debt {
  // ...existentes sin cambios...
  currency String @default("EUR")
}

model ExchangeRate {
  id            Int      @id @default(autoincrement())
  date          DateTime // normalizada a 00:00 UTC — es una fecha, no un instante
  baseCurrency  String   // siempre "EUR": es la moneda pivote
  quoteCurrency String
  rate          Decimal  @db.Decimal(18, 8)
  provider      String   // "frankfurter"
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([date, baseCurrency, quoteCurrency])
  @@index([date])
}
```

Semántica de los campos nuevos de `Transaction`:

- `currency`: moneda en la que se expresó el gasto/ingreso original (lo que
  pagaste). `amount` (ya existente) sigue siendo el importe en esa moneda —
  **no cambia de significado**, sigue siendo lo que afecta al saldo de la
  cartera tal como hoy, salvo que `accountAmount` diga lo contrario (ver más
  abajo).
- `baseAmount`: equivalente de `amount` en `user.currency`, calculado **una
  vez, al crear la transacción**, con el tipo de cambio histórico de esa
  fecha. `NULL` cuando `currency === user.currency en ese momento` (evita
  duplicar el dato cuando no aporta nada). No se recalcula nunca después de
  creada — es precisamente lo que permite que las estadísticas de un mes
  cerrado no se muevan si el tipo de cambio cambia más tarde.
- `exchangeRate`: el tipo usado para obtener `baseAmount`, guardado junto al
  dato. Permite auditar/reconstruir sin volver a llamar al provider.
- `accountAmount` / `accountCurrency`: importe y moneda que **realmente**
  cargó el banco, cuando se conoce (Open Banking / Wallet, no implementado
  hoy, pero el modelo debe soportarlo sin cambios adicionales el día que
  llegue esa integración). Si están presentes, tienen prioridad sobre
  `amount` para calcular el efecto real en el saldo de la cartera.

### Campos que NO se tocan

`Wallet.currency`, `Goal.currency`, `GoalAllocation`, `InvestmentAsset.currency`,
`InvestmentValuationSnapshot.currency`, `AllocationPlan.currency` — ya existen
y su semántica actual es correcta. `Wallet.balance`, `Transaction.amount`,
`Debt.totalAmount/payed/remainingAmount`, `InvestmentOperation.amount`,
`Trip.cost/budget`, `Budget.totalLimit`/`BudgetCategoryLimit.limit` — se
quedan en `Float` (decisión 2).

`GoalAllocation` ya exige que `wallet.currency === goal.currency`
([goals.service.ts:83](../../../src/modules/goals/goals.service.ts#L83)); no
hace falta ningún cambio ahí.

## 2. Migración

Un `prisma db push` (así es como opera hoy este proyecto, sin carpeta
`migrations/`) con columnas nuevas, todas `NOT NULL DEFAULT` o `NULL` — cero
riesgo de pérdida de datos, cero downtime. Backfill explícito por claridad,
aunque el `DEFAULT` ya lo cubre:

```sql
UPDATE "Transaction" SET currency = 'EUR' WHERE currency IS NULL;
UPDATE "Budget" SET currency = 'EUR' WHERE currency IS NULL;
UPDATE "Trip" SET currency = 'EUR' WHERE currency IS NULL;
UPDATE "Debt" d SET currency = COALESCE(
  (SELECT w.currency FROM "Wallet" w WHERE w.id = d."walletId"), 'EUR'
) WHERE d.currency IS NULL;
```

`baseAmount`/`exchangeRate`/`accountAmount`/`accountCurrency` quedan `NULL`
en filas existentes. Es correcto: todas eran EUR y `user.currency` de
usuarios existentes también migra a `'EUR'` (ya es el default), así que la
regla "`baseAmount` es NULL cuando `currency === user.currency`" ya las
cubre — no hace falta ir fila a fila reconstruyendo un tipo de cambio
histórico que además no aportaría nada (EUR→EUR es siempre 1).

## 3. CurrencyService (`spendly-backend/src/modules/currency/currency.service.ts`)

```ts
class CurrencyService {
  getCurrentRate(from: string, to: string): Promise<Decimal>;
  getHistoricalRate(from: string, to: string, date: Date): Promise<Decimal>;
  convert(amount: number | Decimal, from: string, to: string, date?: Date): Promise<Decimal>;
  convertToBase(userId: number, amount: number | Decimal, currency: string, date?: Date): Promise<Decimal>;
  round(amount: number | Decimal, currency: string): Decimal; // JPY 0 decimales, resto 2
}
```

Reglas internas:

- `from === to` → devuelve el importe tal cual, sin tocar la base de datos
  (caso EUR→EUR, el más frecuente hoy, con coste cero).
- Si ni `from` ni `to` son `EUR`, resuelve como cruce: `from→EUR` y
  `EUR→to`, ambos leídos de `ExchangeRate` (ver punto 6). Nunca se guarda una
  fila cruzada aparte.
- `getCurrentRate` usa la fila más reciente en `ExchangeRate` para la fecha de
  hoy (o la última disponible si el cron aún no corrió hoy).
- `getHistoricalRate` busca primero la fila exacta de esa fecha; si no
  existe, delega en el provider (punto 7) y la persiste al vuelo antes de
  devolverla, así la siguiente consulta para esa fecha no vuelve a llamar
  fuera.
- Es el **único** sitio del backend que hace aritmética de conversión de
  divisas. Ningún otro módulo debe llamar al provider ni calcular un tipo de
  cambio por su cuenta.

## 4-5. ExchangeRateProvider + FrankfurterProvider

```ts
interface ExchangeRateProvider {
  getLatestRates(base: string, quotes: string[]): Promise<Record<string, number>>;
  getHistoricalRate(base: string, quote: string, date: Date): Promise<number | null>;
}
```

`FrankfurterProvider` implementa esto contra `https://api.frankfurter.dev`
(datos BCE). Se registra con un token de inyección
(`EXCHANGE_RATE_PROVIDER`) en `CurrencyModule`, de forma que sustituirlo en
el futuro es cambiar el `provide` de ese módulo, sin tocar `CurrencyService`
ni ningún consumidor.

`getHistoricalRate` devuelve `null` (nunca lanza) cuando el provider no tiene
dato para esa fecha exacta — Frankfurter ya resuelve fines de semana/festivos
devolviendo el último día hábil, así que en la práctica esto solo pasa si el
provider está caído o la fecha es anterior a su cobertura.

## 6-7. Cache, cron y fallback

**Cron diario** (`@nestjs/schedule`, mismo patrón que
[transactions-recurring.scheduler.ts](../../../src/modules/transactions/transactions-recurring.scheduler.ts)),
a las 07:00: `getLatestRates('EUR', monedasEnUso)` → una fila `ExchangeRate`
por moneda, fecha de hoy. "Monedas en uso" = `DISTINCT currency` de `Wallet`
∪ `Transaction` ∪ `Goal` ∪ `Trip` ∪ `Budget` ∪ `Debt` ∪ `InvestmentAsset`, más
`EUR` siempre.

**Nunca se llama al provider desde una petición de usuario.** Si
`CurrencyService` necesita un rate y no está en cache:

1. Pide al provider ese día exacto.
2. Si el provider no tiene ese día (festivo) → el provider ya lo resuelve
   con el último hábil.
3. Si el provider está caído (excepción de red) → cae al **último rate
   conocido anterior a esa fecha** en `ExchangeRate` para ese par de
   monedas, y registra un log de aviso. Nunca se inventa un número que no
   venga de (2) o de una fila real en cache.
4. Si no hay ninguna fila previa ni el provider responde → excepción
   controlada (`ServiceUnavailableException`), que el llamador decide cómo
   mostrar (p.ej. dashboard muestra "—" para esa moneda en vez de romper
   toda la página).

**Regla histórico vs actual** (aplicada de forma centralizada, no repetida
por módulo):

| Caso | Tipo de cambio |
|---|---|
| `Transaction.baseAmount` (se fija al crear) | histórico, fecha de la transacción |
| Estadísticas / gasto por categoría / presupuestos | histórico, por transacción (usa `baseAmount` ya calculado) |
| Saldo de `Wallet`, patrimonio neto, valor de inversión | actual |

## 8. Prioridad de importes en una transacción

Para calcular el impacto real sobre el saldo de una cartera:

1. `accountAmount` (en `accountCurrency`) si existe — es lo que de verdad
   cargó el banco.
2. si no, `amount` (en `currency`) — como hoy, sin cambios.

`baseAmount` **nunca** se usa para tocar el saldo de una cartera; solo sirve
para consolidar/mostrar en la moneda del usuario.

## 9. Patrimonio neto

Nuevo método (probable ubicación: `dashboard.service.ts`, a confirmar en el
plan) `getNetWorth(userId)`:

```
for each wallet activa del usuario:
  amountInBase = wallet.currency === user.currency
    ? wallet.balance
    : await currencyService.convert(wallet.balance, wallet.currency, user.currency) // actual
netWorth = sum(amountInBase) + valor de inversiones consolidado igual
```

No se persiste ningún "saldo en EUR" en `Wallet` — se calcula al vuelo cada
vez, como pide el punto 11 del encargo original.

## 10. Estadísticas (`dashboard.service.ts`, `budgets.service.ts`)

Los `prisma.transaction.aggregate({ _sum: { amount } })` actuales
([dashboard.service.ts:20](../../../src/modules/dashboard/dashboard.service.ts#L20)
y similares en `budgets.service.ts`) asumen que sumar `amount` crudo es
correcto — cierto solo si todo es EUR. Pasan a sumar `COALESCE(baseAmount,
amount)`: para una transacción EUR (`baseAmount` NULL) es exactamente el
comportamiento actual, coste cero; para una transacción en otra moneda, usa
el valor ya convertido al histórico en el momento de crearla.

`budgets.service.ts`: mismo cambio, pero convirtiendo a `Budget.currency` en
vez de a `user.currency` cuando difieren (un presupuesto puede estar en una
moneda distinta a la base del usuario).

## 11. Goals / Trips / Debts / Projects

- **Goals:** sin cambios de lógica — la restricción de moneda igual entre
  `Wallet` y `Goal` ya existe y sigue siendo la única regla.
- **Trips:** `Trip.currency` nueva (punto 1). El cálculo de `trip.cost` en
  [trips.service.ts:510](../../../src/modules/trips/trips.service.ts#L510)
  hoy sume `TripPlanItem.cost` ignorando `TripPlanItem.currency` cuando
  difiere del resto — es un bug latente ya presente, no algo que introduzca
  esta entrega, pero se corrige aquí de paso: cada `item.cost` se convierte a
  `Trip.currency` (histórico, fecha del plan item) antes de sumar.
- **Debts:** `Debt.currency` nueva, heredada de la cartera vinculada si la
  hay. Sin lógica de conversión adicional en esta entrega — las deudas no
  entran en patrimonio neto ni estadísticas globales hoy, así que no hace
  falta tocar agregaciones.
- **Projects:** fuera de alcance explícito — no se menciona en el encargo
  original y `ProjectManualEntry.amount` no tiene concepto de moneda propia
  hoy. Se deja igual.

## 12. Investments

`InvestmentAsset.currency` (moneda del activo, p.ej. USD para AAPL) sigue
siendo independiente de `user.currency`. Cambios:

- Valor y rentabilidad del activo (`investmentReturn.ts`, no tocado) se
  siguen calculando en la moneda del activo — **no se mezcla rentabilidad
  del activo con efecto divisa** en esta entrega, tal como permite el
  encargo.
- Para el total consolidado de patrimonio/inversión, el valor de cada activo
  se convierte con `getCurrentRate(asset.currency, user.currency)` solo en el
  punto de agregación final, sin persistir nada nuevo.
- `InvestmentOperation.amount`: representa el cash-flow a través de la
  `Transaction` vinculada (si la hay) — se apoya en el mismo mecanismo de
  `Transaction.currency`/`baseAmount`, sin campos nuevos en
  `InvestmentOperation`.
- **TODO explícito, no se construye ahora:** separar analíticamente "asset
  performance" vs "efecto FX" vs "total return en moneda del usuario". El
  modelo (campos de `Transaction` + `getCurrentRate`/`getHistoricalRate`)
  queda preparado para poder construirlo después.

## 13. Apple Wallet / importación

[walletAmount.ts](../../../../spendly/src/utils/walletAmount.ts) (frontend)
ya normaliza a `{ amount, currency }` decodificando vía `URLSearchParams`,
sin depender del percent-encoding, y devuelve `currency: null` cuando el
símbolo es ambiguo (`$`, `¥`) en vez de asumir. Ya cumple el punto 16 del
encargo tal cual está. Cambio necesario: cuando el usuario confirme/edite la
moneda detectada en el formulario, ese `currency` se envía ahora en el
payload de creación de transacción (hoy no se envía — es puramente visual
desde la sesión anterior).

## 14. Frontend

- **`formatCurrency(amount, currency, locale?)`** nuevo en
  [utils/currency.ts](../../../../spendly/src/utils/currency.ts), basado en
  `Intl.NumberFormat`. Maneja monedas sin decimales (JPY) vía
  `minimumFractionDigits`/`maximumFractionDigits` derivados de la moneda, no
  hardcodeados a 2.
- **`formatEuro` se conserva como wrapper**: `formatEuro(n) = formatCurrency(n, 'EUR')`.
  No se tocan los ~82 archivos que ya la usan — siguen funcionando igual, sin
  duplicar la lógica de formateo (una sola implementación real, en
  `formatCurrency`).
- Se reescriben a `formatCurrency` explícito solo las pantallas donde la
  moneda ya puede no ser EUR tras esta entrega: lista/detalle de Wallets,
  lista/creación/edición de transacciones, Goals, Budgets, resumen de Trip,
  patrimonio neto/Home. El resto no se toca.
- **Selector de moneda:** se reutiliza `CurrencyPickerModal`
  ([spendly/src/components/CurrencyPickerModal.tsx](../../../../spendly/src/components/CurrencyPickerModal.tsx)),
  ya construido, en los formularios de creación/edición de Wallet, Goal,
  Budget y Trip. Por defecto, `user.currency`.
- **Settings:** una fila nueva "Moneda principal" en la pantalla de perfil
  (ubicación exacta a confirmar al implementar — candidatas:
  `AccountScreen.tsx` o una pantalla de ajustes dedicada), con el mismo
  `CurrencyPickerModal`, guardando vía `PATCH /users/me` (nuevo campo
  `currency` en `UpdateProfileDto`). Cambiar la moneda base **no** dispara
  ningún recálculo ni reescritura de datos — solo cambia a qué moneda
  convierten `getCurrentRate`/`convertToBase` las pantallas que lo consultan.
- Ninguna conversión monetaria se calcula dentro de un componente React: todo
  pasa por `formatCurrency` (presentación) o por llamadas al backend que ya
  devuelven el valor convertido (`CurrencyService`).

## 15. Compatibilidad — qué NO debe romperse

- Creación/edición manual de transacciones: `amount` sigue siendo obligatorio
  y en la moneda de la cartera elegida; `currency` se autorrellena con
  `wallet.currency` si no se manda explícitamente — el body actual sigue
  siendo válido sin cambios.
- Flujo Apple Wallet actual: sin cambios de contrato, solo un campo opcional
  más en el payload.
- Estadísticas/presupuestos con datos 100% EUR (el caso de hoy para todo
  usuario existente): `baseAmount` es `NULL` en todas sus transacciones,
  `COALESCE(baseAmount, amount)` devuelve `amount` — resultado idéntico al
  actual, verificable con los tests existentes de `dashboard`/`budgets` si
  los hay, o con los nuevos que añade esta entrega.
- Goals: sin cambios de comportamiento.

## 16. Tests

**Backend:**
- `CurrencyService`: EUR→EUR (no toca DB), EUR→CHF, CHF→EUR, CHF→USD (cruce
  vía EUR), rate histórico existente, rate histórico ausente → provider →
  persistido, provider caído → fallback a último rate en cache, provider
  caído sin cache previo → excepción controlada, redondeo JPY (0 decimales)
  vs EUR (2 decimales).
- Creación de `Transaction`: `baseAmount`/`exchangeRate` se calculan y
  persisten cuando `currency !== user.currency`; quedan `NULL` cuando son
  iguales.
- `dashboard`/`budgets`: agregación con transacciones mezcladas EUR+CHF+USD
  da el total esperado en la moneda base; con todo EUR da exactamente lo
  mismo que antes de este cambio.
- Goals: `GoalAllocation` acepta cartera de la misma moneda que el `Goal`,
  rechaza una de moneda distinta (comportamiento ya existente — test de
  regresión, no de código nuevo).
- Patrimonio neto con carteras en varias monedas.

**Frontend:**
- `formatCurrency`: EUR, USD, CHF, GBP, JPY (sin decimales), locale.
- `parseWalletAmount` (ya existente) — no se toca, tests actuales siguen
  pasando.

## 17. Orden de implementación (checkpoints)

1. Schema (`db push`) + backfill.
2. `CurrencyService` + `FrankfurterProvider` + `ExchangeRate` + cron, con sus
   tests. **Checkpoint: revisar conversiones antes de continuar.**
3. `Transaction` (cálculo de `baseAmount` al crear) + `Wallet`/patrimonio
   neto (`getCurrentRate` en la agregación).
4. Estadísticas: `dashboard.service.ts`, `budgets.service.ts`.
5. `Trip`/`Debt`/`Investments` (consolidación, sin analítica FX nueva).
6. Frontend: `formatCurrency`, selectores de moneda, Settings.
7. Tests finales + `tsc`/lint en ambos repos.

## Fuera de alcance (TODO explícito, no se construye en esta entrega)

- Migrar `Float` → `Decimal` en campos de dinero existentes.
- Separar rentabilidad de activo vs efecto FX en inversiones.
- Conversión automática de `GoalAllocation` entre monedas distintas.
- Integración real con Open Banking (`accountAmount`/`accountCurrency` quedan
  preparados en el modelo, sin ningún proveedor real detrás todavía).
- Pantallas 100% EUR que no se tocan (siguen usando `formatEuro`).
