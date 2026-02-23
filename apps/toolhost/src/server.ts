#!/usr/bin/env node

/**
 * Wooblay Tool Host — MCP Server
 *
 * Exposes supervised tools (wooblay_exec, wooblay_http) via
 * the Model Context Protocol over stdio transport.
 *
 * Each tool call is routed through the Wooblay Gate for risk classification,
 * policy evaluation, and optional human approval before execution.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { getAgentIdentity } from './identity/agent.js';
import { createGateClient } from './gate/client.js';
import { registerExecTool } from './tools/exec.js';
import { registerHttpTool } from './tools/http.js';

// ── Bootstrap ────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load agent identity (fails fast if env vars are missing)
  const identity = getAgentIdentity();
  console.error(
    `[toolhost] Agent identity loaded (pubkey: ${identity.publicKey.slice(0, 16)}…)`,
  );

  // 2. Configure Gate client
  const gateUrl = process.env.WOOBLAY_GATE_URL || 'http://localhost:4800';
  const gateClient = createGateClient();
  console.error(`[toolhost] Gate URL: ${gateUrl}`);

  // 3. Create the MCP server
  const server = new McpServer({
    name: 'wooblay-toolhost',
    version: '0.1.0',
  });

  // 4. Register tools
  registerExecTool(server, gateClient);
  registerHttpTool(server, gateClient);
  console.error('[toolhost] Tools registered: wooblay_exec, wooblay_http');

  // 5. Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[toolhost] MCP server running on stdio');

  // 7. Graceful shutdown
  const shutdown = async () => {
    console.error('[toolhost] Shutting down…');
    await server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => {
  console.error('[toolhost] Fatal startup error:', err);
  process.exit(1);
});
