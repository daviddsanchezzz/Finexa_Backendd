-- Distingue, dentro de una retirada (kind = withdrawal), si es una retirada
-- de beneficio ya generado o una devolución del capital previamente
-- aportado por el socio. No afecta a income/expense/result ni a la fórmula
-- de caja (que sigue sumando el total de retiradas, ahora desglosado en dos
-- lecturas). Todas las retiradas existentes eran repartos de beneficio
-- (el concepto de devolución de capital no existía hasta ahora), así que el
-- default `false` las clasifica correctamente sin backfill.
ALTER TABLE "ProjectManualEntry" ADD COLUMN "isCapitalReturn" BOOLEAN NOT NULL DEFAULT false;
