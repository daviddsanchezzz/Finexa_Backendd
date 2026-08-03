# Tu mundo — rediseño (Entrega 1)

**Fecha:** 2026-08-03
**Repos afectados:** `spendly` (frontend, React Native/Expo) y `spendly-backend` (NestJS)
**Alcance:** Rediseño de la pantalla a la que se llega al tocar el badge "19% Mundo" en `TravelsScreen`. Incluye resumen "Tu mundo", checklist de países por continente ("Mis países"), y sección "Maravillas del mundo" (catálogo fijo de 14 maravillas con marcado de visitada + foto + fecha).

## Fuera de alcance (Entrega 2, spec separada)

El mapa mundial interactivo con las formas SVG reales de los 195 países (dataset geográfico + choropleth) es una pieza técnica independiente y se entrega después. En esta entrega, la pantalla "Tu mundo" usa una versión ampliada del mapa estilizado/abstracto que ya existe como miniatura (manchas por continente + puntos), sin fronteras reales ni interactividad país-por-país.

## Motivación

Hoy el badge "19%" en `TravelsScreen.tsx:420-434` es un `View` estático sin `onPress`, con datos ya calculados (`visitedPct`, `visitedCountries` desde `GET /trips/summary`) pero sin ningún destino al tocarlo. El usuario quiere convertir ese badge en la puerta de entrada a una experiencia "Tu mundo" completa: mapa, desglose por continente, checklist de países visitados, y un tracker de las 14 maravillas del mundo (modernas y antiguas) con foto y fecha de visita.

## Arquitectura backend

Nuevo módulo `world` en NestJS. No se modifican los endpoints existentes `/trips/summary` y `/trips/continents-stats` (siguen usándolos `TravelsScreen` y `TripsHomeDesktopScreen` sin cambios).

### Datos estáticos (constantes, no tablas editables)

- **Lista de 195 países reconocidos por la ONU**, agrupados por continente, con código ISO2 y nombre en español. Vive en el backend (p. ej. `src/modules/world/data/countries.data.ts`).
- **Catálogo fijo de 14 maravillas del mundo**, con `key`, `name`, `country` (ISO2), `era` (`modern` | `ancient`). Vive en `src/modules/world/data/wonders.data.ts`.

Modernas (7): Gran Muralla China (CN), Petra (JO), Cristo Redentor (BR), Machu Picchu (PE), Chichén Itzá (MX), Coliseo (IT), Taj Mahal (IN).
Antiguas (7, históricas): Gran Pirámide de Guiza (EG), Jardines Colgantes de Babilonia (IQ), Estatua de Zeus (GR), Templo de Artemisa (TR), Mausoleo de Halicarnaso (TR), Coloso de Rodas (GR), Faro de Alejandría (EG).

### Modelo de datos nuevo (Prisma)

```prisma
model WonderVisit {
  id         String   @id @default(cuid())
  userId     String
  wonderKey  String   // clave del catálogo fijo, p.ej. "machu_picchu"
  visitedAt  DateTime?
  photoUrl   String?
  tripId     String?  // FK opcional a Trip
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user User  @relation(fields: [userId], references: [id])
  trip Trip? @relation(fields: [tripId], references: [id])

  @@unique([userId, wonderKey])
}
```

### Endpoints nuevos

```
GET  /world/overview
  → { visitedPct, visitedCountries, totalCountries,
      continents: [{ continent, visited, total, pct }],
      wondersVisited, wondersTotal }
  (recalcula lo mismo que /trips/summary + /trips/continents-stats,
   agregado en una sola respuesta para la nueva pantalla)

GET  /world/countries
  → países agrupados por continente:
    { continent, countries: [{ code, nameEs, visited: bool }] }
    (visited = derivado de Trip.country del usuario, cruzado
     contra la lista estática de 195 países)

GET  /world/wonders
  → 14 maravillas (catálogo fijo) + estado del usuario:
    [{ key, name, country, era, visited, visitedAt, photoUrl, tripId }]

PATCH /world/wonders/:key
  body: { visited: boolean, visitedAt?, photoUrl?, tripId? }
  → visited:true crea/actualiza (upsert) el WonderVisit del usuario;
    visited:false borra el registro (sin soft-delete, no hay
    campo deletedAt en el modelo)
```

Para el selector "Vincular a un viaje" en el detalle de maravilla, se reutiliza `GET /trips?country=<ISO2>` (si el endpoint actual no soporta filtro por país, se añade el query param — cambio menor y aislado).

## Frontend — pantallas nuevas

Todas en `spendly/src/screens/Mobile/finances/travels/`, siguiendo el patrón flat-file-per-screen existente en ese módulo (`MaletaScreen.tsx`, `ReservasScreen.tsx`).

### 1. `WorldOverviewScreen.tsx` ("Tu mundo")
- Mapa placeholder estilizado (ampliado respecto a la miniatura actual de `TravelsScreen`), sin interactividad por país (ver "Fuera de alcance").
- `% del mundo` + `X países` (de `GET /world/overview`).
- Lista de continentes con barra de progreso `visited/total · pct%` — tap en un continente → `CountryChecklistScreen` con ese continente preseleccionado.
- Tarjeta "Maravillas del mundo · X/14" → tap → `WondersScreen`.

### 2. `CountryChecklistScreen.tsx` ("Mis países")
- Tabs por continente (Europa/Asia/América/África/Oceanía).
- Lista de países del continente activo con icono check (verde, relleno) si `visited`, círculo vacío si no.
- **Solo lectura** — el estado se deriva automáticamente de los viajes registrados en Trips; no hay checkbox editable a mano (evita desincronización entre "países visitados" y los viajes reales).

### 3. `WondersScreen.tsx` ("Maravillas del mundo")
- Tabs Modernas / Antiguas.
- Contador "X de 7 visitadas" por tab.
- Cards por maravilla: nombre, país, y estado — "✓ Visitado · <fecha>" (verde) o "Marcar como visitada" (gris) — tap → `WonderDetailScreen`.

### 4. `WonderDetailScreen.tsx`
- Tile de foto: reutiliza el patrón de `spendly/src/utils/uploadTripCover.ts` (subida a Supabase Storage bucket `documents`), nueva función `pickAndUploadWonderPhoto()` siguiendo el mismo formato que `pickAndUploadTripCover()`.
- Toggle "Marcar como visitada".
- Selector de fecha con `CrossPlatformDateTimePicker` (visible solo si el toggle está activo).
- Selector "Vincular a un viaje (opcional)" — dropdown filtrado a los viajes cuyo país coincide con el país de la maravilla (`GET /trips?country=<ISO2>`).
- Botón "Guardar" → `PATCH /world/wonders/:key`.

## Navegación

- `TravelsScreen.tsx:420-434`: el badge pasa de `View` a `TouchableOpacity` → `navigation.navigate("WorldOverview")`.
- Nuevas entradas en `RootStackParamList` (`spendly/src/navigation/MobileNavigator.tsx`):
  ```ts
  WorldOverview: undefined;
  CountryChecklist: { continent?: ContinentKey } | undefined;
  Wonders: undefined;
  WonderDetail: { wonderKey: string };
  ```
- Registro de las 4 pantallas con el mismo patrón lazy `getComponent={() => require(...).default}` usado por `Maleta`/`Reservas`/`TripDocuments`, ubicadas junto a ese bloque en `MobileNavigator.tsx`.

## Flujo de datos

- Cada pantalla hace fetch al montar (`GET /world/overview`, `/world/countries`, `/world/wonders`).
- Al guardar en `WonderDetailScreen`: si hay foto nueva, se sube primero (Supabase Storage) y se obtiene la URL; luego `PATCH /world/wonders/:key` con `{ visited, visitedAt, photoUrl, tripId }`; al volver atrás, `WondersScreen` refresca vía refetch on-focus (mismo patrón que otras pantallas del módulo Trips).

## Manejo de errores

Se sigue el patrón ya existente en el módulo Trips: spinner de carga + `try/catch` con estado de error simple. No se introduce un sistema de toasts/snackbar nuevo — es deuda técnica conocida y transversal al proyecto, fuera de alcance de esta feature.

## Testing

El proyecto no tiene suite de tests automatizados. Verificación manual en navegador (React Native Web) tras implementar: recorrer el flujo completo (badge → Tu mundo → Mis países → Maravillas → detalle → marcar visitada con foto y fecha → volver y confirmar que el contador se actualiza).

## Decisiones registradas durante el diseño

- Países visitados: derivados automáticamente de los viajes en Trips (no editable a mano).
- Catálogo de maravillas: fijo y hardcodeado (14 maravillas estándar), no configurable desde backend.
- Foto de maravilla: reutiliza el patrón de subida ya existente (`uploadTripCover.ts` → Supabase Storage).
- Marcar una maravilla como visitada es independiente del estado de "país visitado" — no hay sincronización automática entre ambos.
- El selector "vincular a viaje" filtra solo los viajes del mismo país que la maravilla.
- El mapa SVG real con los 195 países se deja para una entrega 2 separada; aquí se usa un placeholder estilizado.
