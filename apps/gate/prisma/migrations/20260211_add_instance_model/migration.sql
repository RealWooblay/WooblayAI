-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "agentRuntime" TEXT NOT NULL DEFAULT 'openclaw',
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "configJson" TEXT,
    "containerId" TEXT,
    "telegramBot" TEXT,
    "endpoint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Instance_name_key" ON "Instance"("name");

-- CreateIndex
CREATE INDEX "Instance_status_idx" ON "Instance"("status");

-- CreateIndex
CREATE INDEX "Instance_agentRuntime_idx" ON "Instance"("agentRuntime");
