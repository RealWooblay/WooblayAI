-- Add business-context category to ToolCall
ALTER TABLE "ToolCall" ADD COLUMN "category" TEXT;
CREATE INDEX "ToolCall_category_idx" ON "ToolCall"("category");

-- Add category matching, source tracking, and description to PolicyRule
ALTER TABLE "PolicyRule" ADD COLUMN "matchCategory" TEXT;
ALTER TABLE "PolicyRule" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "PolicyRule" ADD COLUMN "description" TEXT;

-- Add role fields to Instance
ALTER TABLE "Instance" ADD COLUMN "inferredRole" TEXT;
ALTER TABLE "Instance" ADD COLUMN "role" TEXT;
