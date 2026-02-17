-- Add operation chaining support for follow-up operations
-- parentOperationId: links follow-up operations to their parent (fix → verify → deploy)
-- followUpConfig: JSON config defining what follow-ups to create when this operation resolves
ALTER TABLE "Incident" ADD COLUMN "parentOperationId" TEXT;
ALTER TABLE "Incident" ADD COLUMN "followUpConfig" TEXT;
CREATE INDEX "Incident_parentOperationId_idx" ON "Incident"("parentOperationId");
