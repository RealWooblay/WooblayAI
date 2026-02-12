-- AlterTable: Add identity + trust fields to Agent
ALTER TABLE "Agent" ADD COLUMN "trustLevel" TEXT NOT NULL DEFAULT 'read-only';
ALTER TABLE "Agent" ADD COLUMN "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 50;
ALTER TABLE "Agent" ADD COLUMN "parentPubkey" TEXT;
ALTER TABLE "Agent" ADD COLUMN "spawnDepth" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "profileJson" TEXT;
ALTER TABLE "Agent" ADD COLUMN "baselineJson" TEXT;

-- AddForeignKey: Agent self-relation for lineage
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_parentPubkey_fkey" FOREIGN KEY ("parentPubkey") REFERENCES "Agent"("pubkey") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Agent_parentPubkey_idx" ON "Agent"("parentPubkey");
CREATE INDEX "Agent_trustLevel_idx" ON "Agent"("trustLevel");

-- CreateTable: SpawnAttestation
CREATE TABLE "SpawnAttestation" (
    "id" TEXT NOT NULL,
    "spawnerPubkey" TEXT NOT NULL,
    "spawnedPubkey" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "scopeJson" TEXT,
    "constraints" TEXT,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpawnAttestation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SpawnAttestation_spawnerPubkey_idx" ON "SpawnAttestation"("spawnerPubkey");
CREATE INDEX "SpawnAttestation_spawnedPubkey_idx" ON "SpawnAttestation"("spawnedPubkey");

ALTER TABLE "SpawnAttestation" ADD CONSTRAINT "SpawnAttestation_spawnerPubkey_fkey" FOREIGN KEY ("spawnerPubkey") REFERENCES "Agent"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SpawnAttestation" ADD CONSTRAINT "SpawnAttestation_spawnedPubkey_fkey" FOREIGN KEY ("spawnedPubkey") REFERENCES "Agent"("pubkey") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: Analysis
CREATE TABLE "Analysis" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "receiptId" TEXT,
    "agentPubkey" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "tags" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "findings" TEXT NOT NULL,
    "causalChain" TEXT,
    "briefMarkdown" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Analysis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Analysis_taskId_idx" ON "Analysis"("taskId");
CREATE INDEX "Analysis_receiptId_idx" ON "Analysis"("receiptId");
CREATE INDEX "Analysis_agentPubkey_idx" ON "Analysis"("agentPubkey");
CREATE INDEX "Analysis_severity_idx" ON "Analysis"("severity");
CREATE INDEX "Analysis_createdAt_idx" ON "Analysis"("createdAt");

-- CreateTable: Canary
CREATE TABLE "Canary" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "trippedBy" TEXT,
    "trippedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Canary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Canary_active_idx" ON "Canary"("active");
CREATE INDEX "Canary_type_idx" ON "Canary"("type");
