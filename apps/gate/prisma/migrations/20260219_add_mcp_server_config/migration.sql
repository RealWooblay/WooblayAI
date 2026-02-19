-- MCP server configurations per instance.
-- The MCP proxy connects to each configured upstream server, discovers tools,
-- and gates every call through the policy engine. Credentials are resolved
-- from vault connections at Layer 3 exec time — never stored here.

CREATE TABLE "McpServerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "args" TEXT,
    "connectionIds" TEXT NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "McpServerConfig_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "McpServerConfig_instanceId_name_key" ON "McpServerConfig"("instanceId", "name");
CREATE INDEX "McpServerConfig_instanceId_idx" ON "McpServerConfig"("instanceId");
CREATE INDEX "McpServerConfig_enabled_idx" ON "McpServerConfig"("enabled");
