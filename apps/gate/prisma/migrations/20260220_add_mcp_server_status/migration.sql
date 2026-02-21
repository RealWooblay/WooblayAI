-- Add connection status tracking to MCP server configs.
-- The proxy reports back after connecting to each upstream so the UI
-- can show whether the server is actually working.

ALTER TABLE "McpServerConfig" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "McpServerConfig" ADD COLUMN "toolCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "McpServerConfig" ADD COLUMN "lastError" TEXT;
