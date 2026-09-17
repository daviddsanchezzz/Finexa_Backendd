# Proyectos: perspectiva personal en la pantalla general (segundo ajuste)

## Contexto

El primer ajuste (migración `20260916140000_project_movement_kind_partner_link`) ya separó
correctamente, a nivel de modelo, el resultado del proyecto (`income`/`expense`) de los
movimientos de capital de un socio (`contribution`/`withdrawal`), y vinculó estos últimos a un
`ProjectPartner` real vía `partnerId`.

Este segundo ajuste no toca esa base. Cambia qué información se prioriza en la pantalla general
de Proyectos: en vez de la rentabilidad global del conjunto de proyectos, se prioriza "cuánto
dinero he ganado yo" — la parte del resultado de cada proyecto que corresponde al usuario según
su `percentage` de participación.

Para poder calcularlo sin mezclar conceptos hace falta primero cerrar un hueco del modelo: hoy
`withdrawal` es un único tipo que sirve tanto para "ya cobré mi parte del beneficio" como para
"me devolvieron el capital que aporté", indistinguibles salvo por un `category` de texto libre
opcional. Sin esa distinción, "retirado" y "pendiente" mezclarían beneficio con capital, que es
exactamente lo que la spec del usuario prohíbe.

## Alcance

- Backend (`spendly-backend`): migración de schema + cambios en `ProjectsService`/DTOs.
- Frontend (`spendly`): `ProjectsScreen`, `ProjectDetailScreen`, nuevo `src/types/project.ts`.
- No se toca: `ProjectFormScreen`, el flujo de `attach/detach-transactions`, el reparto de
  beneficios (`distribute-profit`) más allá de que sigue generando `isCapitalReturn: false`.

## 1. Modelo de datos

Añadir un campo booleano a `ProjectManualEntry`, significativo solo cuando `kind = withdrawal`:

```prisma
model ProjectManualEntry {
  ...
  kind             ProjectMovementKind
  isCapitalReturn  Boolean @default(false)
  ...
}
```

Migración aditiva con default `false`. No hace falta backfill: hasta ahora todas las retiradas
existentes eran repartos de beneficio (no existía el concepto de devolución de capital), así que
`false` las clasifica correctamente sin tocar una sola fila.

DTOs (`project-manual-entry.dto.ts`): añadir `isCapitalReturn?: boolean` opcional en
`CreateProjectManualEntryDto` (heredado por `UpdateProjectManualEntryDto` vía `PartialType`).
Se persiste tal cual cuando `kind = withdrawal`; para el resto de kinds el servicio lo ignora
(igual que ya hace con `partnerId` en `resolvePartnerId`).

`distributeProfit` sigue creando entradas `kind: 'withdrawal'` sin tocar `isCapitalReturn`
(default `false` = beneficio), que es semánticamente correcto: ese endpoint es un atajo
específicamente para repartir beneficio, nunca para devolver capital.

## 2. Cálculos (`projects.service.ts`)

### `buildFinancialsMap`

El `groupBy` de `ProjectManualEntry` pasa de `['projectId', 'kind']` a
`['projectId', 'kind', 'isCapitalReturn']`. Se separan las retiradas:

```ts
data.withdrawalsProfit = ...   // kind=withdrawal, isCapitalReturn=false
data.withdrawalsCapital = ...  // kind=withdrawal, isCapitalReturn=true
data.withdrawals = data.withdrawalsProfit + data.withdrawalsCapital  // se mantiene, usado por cash
data.cash = data.contributions + data.income - data.expense - data.withdrawals  // sin cambios
```

### Posición del usuario ("mi beneficio")

Nueva función `buildMyPositionMap(userId, projectIds)` que:

1. Carga, para cada proyecto, el `ProjectPartner` con `isMe = true` (a lo sumo uno, por la
   validación existente en `upsertPartners`). Si un proyecto no tiene socios configurados,
   `myPercentage = 100`.
2. Agrupa `ProjectManualEntry` por `partnerId, kind, isCapitalReturn` restringido a esos
   `partnerId` de socios `isMe`, para obtener `myCapitalContributed`, `myWithdrawnProfit`,
   `myCapitalReturned` de cada proyecto.
3. Combina con el resultado de `buildFinancialsMap` para obtener `myProfit = result *
   myPercentage / 100` y `myPending = myProfit - myWithdrawnProfit`.

Estos campos se añaden dentro de `financials` (mismo objeto plano que ya devuelve el backend),
para no introducir una segunda estructura anidada:

```ts
financials: {
  // ya existentes, sin cambios de significado
  transactionsIncome, transactionsExpense, manualIncome, manualExpense,
  income, expense, result, contributions, cash,
  // withdrawals ahora desglosado
  withdrawals, withdrawalsProfit, withdrawalsCapital,
  // nuevo: perspectiva del usuario
  myPercentage, myProfit, myWithdrawnProfit, myCapitalContributed, myCapitalReturned, myPending,
}
```

`findAll` y `findOne` comparten esta lógica (una sola fuente de verdad), igual que hoy comparten
`buildFinancialsMap`.

### Desglose por socio en `findOne`

El `groupBy(['partnerId', 'kind'])` restringido a `contribution|withdrawal` pasa a incluir
`isCapitalReturn`, de forma que cada `partner` devuelto tiene `contributed`, `withdrawnProfit` y
`capitalReturned` en vez de un único `withdrawn` que mezclaba ambos conceptos. Aplica a todos los
socios, no solo al marcado `isMe`, por consistencia (es el mismo query, coste marginal nulo).

## 3. Tipos frontend

`ProjectsScreen`, `ProjectDetailScreen` y `ProjectFormScreen` declaran hoy tipos `Project*`
inline y duplicados. Como los dos primeros necesitan el mismo `financials` ampliado, se extrae a
`spendly/src/types/project.ts`:

```ts
export type ProjectStatus = 'idea' | 'active' | 'paused' | 'completed' | 'cancelled';
export type ProjectMovementKind = 'income' | 'expense' | 'contribution' | 'withdrawal';

export interface ProjectFinancials {
  income: number; expense: number; result: number;
  contributions: number;
  withdrawals: number; withdrawalsProfit: number; withdrawalsCapital: number;
  cash: number;
  myPercentage: number; myProfit: number; myWithdrawnProfit: number;
  myCapitalContributed: number; myCapitalReturned: number; myPending: number;
}

export interface ProjectPartner {
  id: number; name: string; percentage: number; isMe: boolean;
  contributed: number; withdrawnProfit: number; capitalReturned: number;
}

export interface ProjectListItem { id, name, description?, type?, status, startDate, endDate?, notes?, financials: ProjectFinancials }
export interface ProjectDetail extends ProjectListItem { transactions, manualEntries, partners: ProjectPartner[] }
```

No se toca `ProjectFormScreen` (no muestra `financials`, scope innecesario).

## 4. `ProjectsScreen` (pantalla general)

- `totals` (hoy `{income, expense, result}`) pasa a `{myProfit, myWithdrawnProfit}` sumando esos
  dos campos de `financials` en todos los proyectos; `pendiente` se deriva
  (`myProfit - myWithdrawnProfit`), no se sume aparte.
- `HeroBalanceCard`: `label="MI BENEFICIO"`, `value=formatCurrency(totals.myProfit)`. Sin cambios
  de estilo (sigue en blanco sobre el fondo azul, como hoy con "Rentabilidad global").
- `StatsRow`: `GENERADO` (`totals.myProfit`, verde/rojo según signo, como hace hoy "Rentabilidad")
  · `RETIRADO` (`totals.myWithdrawnProfit`, color neutro fijo — nunca rojo, regla de colores) ·
  `PENDIENTE` (`generado - retirado`, verde/rojo).
- Fila de proyecto: el número principal pasa de `financials.result` a `financials.myProfit`
  (mismo color verde/rojo condicional que ya existe). El badge de estado pasa a incluir el
  porcentaje (`"Activo · 50%"`) cuando el proyecto tiene `myPercentage` significativo (partners
  configurados o alguna actividad); se sustituyen los chips ↑ingresos/↓gastos por un texto
  secundario `Resultado proyecto: {result}` con el mismo color condicional pero tipografía menor
  y no negrita, para quitarle peso visual sin perder la señal verde/rojo.
- Estado "Idea" sin socios ni movimientos (`income === 0 && expense === 0 && !partners.length`,
  se puede derivar de si el backend no manda partners y financials está a cero): se oculta el
  importe y el "· %"; se muestra "Sin movimientos todavía" en gris, sin badge de porcentaje.

## 5. `ProjectDetailScreen`

- Cabecera (`HeroBalanceCard` "Resultado del proyecto" + `StatsRow` Ingresos/Gastos): sin cambios.
- Nuevo bloque "TU POSICIÓN" justo debajo, reutilizando `StatsRow` en dos filas de 2 (mismo
  componente que ya usa la pantalla, cero componentes nuevos):
  - Fila 1: `TU PARTICIPACIÓN` (`myPercentage`%, color neutro) · `TU BENEFICIO` (`myProfit`,
    verde/rojo).
  - Fila 2: `RETIRADO` (`myWithdrawnProfit`, color neutro) · `PENDIENTE` (`myPending`,
    verde/rojo).
  - Envuelto en el mismo estilo de tarjeta con borde que ya usa el bloque "Información", con
    label `TU POSICIÓN` arriba (mismo estilo que `SOCIOS`/`NOTAS`).
  - Oculto cuando no hay socios configurados y no hay ningún movimiento (mismo criterio de
    "idea sin actividad" que en el listado).
- Tab Caja — desglose de caja: la fila `Retiradas` se divide en `Retiradas de beneficio`
  (`withdrawalsProfit`) y `Capital devuelto` (`withdrawalsCapital`, solo se muestra si > 0 para
  no añadir una fila vacía). Corrección de colores: `Aportaciones`, `Retiradas de beneficio` y
  `Capital devuelto` pasan de verde/rojo (`colors.success`/`colors.danger`, como si fueran
  ingreso/gasto) a un color neutro (`#334155`), dejando el verde/rojo únicamente para
  `Ingresos`/`Gastos` reales — es una corrección directa de la regla "aportaciones/retiradas no
  son ingresos/gastos" que hoy no se cumplía.
- Sección Socios: cada partner pasa de mostrar `Aportado X · Retirado Y` a
  `Aportado X · Retirado Y` + `· Devuelto Z` solo si `capitalReturned > 0` (caso normal hoy sigue
  viéndose igual).
- Modal "Nuevo movimiento manual": cuando `kind === 'withdrawal'`, aparece un segundo selector
  (mismos pills que el selector de socio) `Retirada de beneficio` / `Devolución de capital`,
  controlando `isCapitalReturn` en el form; por defecto `false` (beneficio). Se envía en el
  payload de `POST/PATCH .../manual-entries`. Al editar una entrada existente, se preselecciona
  desde `entry.isCapitalReturn`.

## 6. Qué NO cambia

- El cálculo de `cash` (caja) es idéntico: sigue sumando/restando el total de `withdrawals`
  (ahora la suma de sus dos desgloses), no se altera su fórmula.
- `distribute-profit` sigue funcionando igual (crea `withdrawal` con `isCapitalReturn: false`).
- Los endpoints de aportaciones (`contribution`) no cambian.
- No hay endpoint de agregados nuevo: la pantalla general sigue sumando en cliente el array de
  `financials` por proyecto, como hoy.
- Filtros Activos/Ideas/Todos: sin cambios de comportamiento.

## Casos límite

- Proyecto sin socios configurados: `myPercentage = 100`, `myWithdrawnProfit = 0` (no se pueden
  crear `contribution`/`withdrawal` sin socio, por la validación existente de `resolvePartnerId`),
  así que `myPending = myProfit`.
- Proyecto "Idea" recién creado (sin transacciones, sin manual entries, sin socios): todos los
  campos de `financials` en cero; UI muestra estado neutro, nunca "0,00 €" como si fuera un dato
  real.
- `myPending` negativo (se ha retirado más beneficio del generado, p. ej. tras una pérdida
  posterior al reparto): se muestra en rojo, es un valor legítimo, no se fuerza a 0.
