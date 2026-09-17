# Objetivos

Objetivos clasifica dinero existente. Este módulo nunca escribe `Wallet.balance`,
crea `Transaction` ni añade importes al patrimonio neto.

## Progreso y estados

- `MANUAL`: suma decimal del historial de `GoalManualEntry`. No se permiten
  retiradas ni correcciones que dejen el progreso total por debajo de cero.
- `ALLOCATIONS`: suma decimal de las asignaciones actuales.
- `WALLET_BALANCE`: saldo de la cartera existente, limitado a cero por abajo.
- Alcanzar el objetivo no cambia automáticamente su estado ni libera dinero.
- `COMPLETED` sigue reservando dinero. Puede volver a `ACTIVE` explícitamente.
- `ARCHIVED` deja de reservar dinero. Se conserva una instantánea del progreso y
  las asignaciones/manual entries para consulta. Una cartera vinculada se
  desvincula. Los archivados solo se pueden consultar o eliminar.
- Método de seguimiento y moneda son inmutables después de crear el objetivo.
  Una conversión futura necesitará una operación explícita de migración.

Todos los cálculos viven en `goal-calculations.ts`. El backend devuelve importes
numéricos y las métricas calculadas; el frontend solo los presenta. Los resúmenes
incluyen objetivos `ACTIVE` y se separan por moneda. El exceso en una meta no
compensa lo que falta en otra.

## Reservas

Las asignaciones y carteras vinculadas de objetivos `ACTIVE` y `COMPLETED`
consumen disponibilidad. Una cartera totalmente vinculada no admite reservas
parciales ni otro vínculo. Se exige propiedad y coincidencia de moneda.

Las mutaciones se ejecutan bajo aislamiento serializable y un advisory lock por
usuario compartido con la edición/eliminación de carteras. Se reintentan los
conflictos de serialización. Una bajada posterior del saldo no cambia las
reservas: `overAllocated` avisa del exceso y se permiten reducciones para
corregirlo. No se permite eliminar ni cambiar la moneda de una cartera reservada.

## API autenticada

- `GET /goals`: objetivos y resúmenes por moneda.
- `GET /goals/wallets`: saldo real, reservas, disponibilidad y exceso por cartera.
- `POST /goals`, `GET/PATCH/DELETE /goals/:id`.
- `PATCH /goals/:id/status`.
- `PUT /goals/:id/allocations`: composición completa; cero elimina la reserva.
- `POST /goals/:id/manual-entries`.
- `PATCH/DELETE /goals/:id/manual-entries/:entryId`.

El archivado y la eliminación necesitan confirmación en la interfaz. El API
revalida todas las reglas al guardar y no confía en la disponibilidad enviada por
el cliente. Las consultas cargan las relaciones en bloques, sin consultas por
cada objetivo/cartera.

## Histórico

El historial manual es real y editable. Para asignaciones solo se muestra la
composición actual; no se inventa una evolución a partir de ella. El modo de
saldo observa la cartera, sin duplicar sus transacciones.

## Base de datos y validación

Migración: `prisma/migrations/20260917150000_goals/migration.sql`.

```sh
npx prisma migrate deploy
npx prisma generate
npm run build
npx jest --runInBand
```

Las relaciones de cartera usan `Restrict` para borrado físico. El borrado lógico
de cartera también se protege en `WalletsService`.
