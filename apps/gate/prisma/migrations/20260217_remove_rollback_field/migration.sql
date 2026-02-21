-- DropIndex
DROP INDEX IF EXISTS "Proposal_rollbackOf_idx";

-- AlterTable
ALTER TABLE "Proposal" DROP COLUMN IF EXISTS "rollbackOf";
