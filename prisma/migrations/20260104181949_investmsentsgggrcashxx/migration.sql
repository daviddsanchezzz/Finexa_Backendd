/*
  Warnings:

  - The values [transfer_in,transfer_out,swap_in,swap_out] on the enum `InvestmentOperationType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InvestmentOperationType_new" AS ENUM ('buy', 'sell', 'swap', 'withdraw', 'deposit');
ALTER TABLE "InvestmentOperation" ALTER COLUMN "type" TYPE "InvestmentOperationType_new" USING ("type"::text::"InvestmentOperationType_new");
ALTER TYPE "InvestmentOperationType" RENAME TO "InvestmentOperationType_old";
ALTER TYPE "InvestmentOperationType_new" RENAME TO "InvestmentOperationType";
DROP TYPE "public"."InvestmentOperationType_old";
COMMIT;
