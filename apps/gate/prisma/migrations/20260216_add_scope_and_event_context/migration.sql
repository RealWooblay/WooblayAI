-- Add AI-classified intent context to Operations
ALTER TABLE "Incident" ADD COLUMN "suggestedIntent" TEXT;
ALTER TABLE "Incident" ADD COLUMN "eventContext" TEXT;

-- Add scope boundaries to Connections (per-action allow/block patterns)
ALTER TABLE "Connection" ADD COLUMN "scopeBoundaries" TEXT;
