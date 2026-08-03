DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ChecklistCategory') THEN
    CREATE TYPE "ChecklistCategory" AS ENUM ('ropa', 'documentos', 'electronica', 'otros');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TripChecklistItem" (
  "id" SERIAL NOT NULL,
  "tripId" INTEGER NOT NULL,
  "category" "ChecklistCategory" NOT NULL,
  "label" TEXT NOT NULL,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TripChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TripChecklistItem_tripId_category_idx"
ON "TripChecklistItem"("tripId", "category");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'TripChecklistItem_tripId_fkey'
  ) THEN
    ALTER TABLE "TripChecklistItem"
      ADD CONSTRAINT "TripChecklistItem_tripId_fkey"
      FOREIGN KEY ("tripId") REFERENCES "Trip"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;
