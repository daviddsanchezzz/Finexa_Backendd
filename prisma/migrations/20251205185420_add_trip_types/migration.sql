/*
  Warnings:

  - The values [activity] on the enum `TripPlanItemType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "TripPlanItemType_new" AS ENUM ('flight', 'accommodation', 'transport', 'taxi', 'museum', 'monument', 'viewpoint', 'free_tour', 'concert', 'bar_party', 'beach', 'restaurant', 'shopping', 'other');
ALTER TABLE "TripPlanItem" ALTER COLUMN "type" TYPE "TripPlanItemType_new" USING ("type"::text::"TripPlanItemType_new");
ALTER TYPE "TripPlanItemType" RENAME TO "TripPlanItemType_old";
ALTER TYPE "TripPlanItemType_new" RENAME TO "TripPlanItemType";
DROP TYPE "public"."TripPlanItemType_old";
COMMIT;

-- AlterTable
ALTER TABLE "TripPlanItem" ADD COLUMN     "cost" DOUBLE PRECISION;
