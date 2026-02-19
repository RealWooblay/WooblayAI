#!/usr/bin/env node

/**
 * Wooblay MCP Proxy — the security membrane between agents and MCP servers.
 *
 * Architecture:
 *   Agent ←(SSE)→ [MCP Proxy :3100] ←→ Gate (L1+L2) ←→ Upstream MCP Server
 *                                              ↘ Secure Exec (L3) for credentialed tools
 *
 * The proxy:
 *   1. Connects to each configured upstream MCP server
 *   2. Discovers all available tools via tools/list
 *   3. Exposes all tools to the agent via SSE on port 3100
 *   4. Intercepts every tool call through the Gate before execution
 *   5. Routes credentialed tools to Layer 3 ephemeral containers
 *
 * Security guarantees:
 *   - Agent never sees credentials
 *   - Every tool call is policy-checked and logged
 *   - Credentialed tools execute in isolated ephemeral containers
 *   - Upstream MCP servers cannot communicate with the agent directly
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { z } from 'zod';

import type { McpServerConfigEntry, UpstreamTool, GateDecision } from './types.js';
import { loadConfig, fetchConfigFromGate } from './config.js';
import { callGate, callGateStructuredExec } from './gate-interceptor.js';

const PORT = parseInt(process.env['MCP_PROXY_PORT'] ?? '3100', 10);
const PROXY_TOKEN = process.env['GATEWAY_TOKEN'] ?? '';

// ── State ────────────────────────────────────────────────────────────────

const upstreamClients = new Map<string, Client>();
const toolRegistry = new Map<string, { tool: UpstreamTool; serverName: string; config: McpServerConfigEntry }>();

// ── Upstream Connection ──────────────────────────────────────────────────

async function connectUpstream(serverConfig: McpServerConfigEntry): Promise<void> {
  if (!serverConfig.enabled) return;

  const log = (msg: string) => process.stderr.write(`[proxy:${serverConfig.name}] ${msg}\n`);

  try {
    let transport;
    if (serverConfig.transport === 'stdio') {
      const parts = serverConfig.source.split(/\s+/);
      // Only pass safe env vars to upstream MCP servers — never leak proxy secrets
      const safeEnv: Record<string, string> = {
        PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: process.env['NODE_ENV'] ?? 'production',
      };
      transport = new StdioClientTransport({
        command: parts[0],
        args: [...parts.slice(1), ...(serverConfig.args ?? [])],
        env: safeEnv,
      });
    } else {
      transport = new SSEClientTransport(new URL(serverConfig.source));
    }

    const client = new Client({
      name: `wooblay-proxy-${serverConfig.name}`,
      version: '0.1.0',
    });

    await client.connect(transport);
    upstreamClients.set(serverConfig.name, client);
    log('connected');

    const { tools } = await client.listTools();
    for (const tool of tools) {
      const qualifiedName = `${serverConfig.name}__${tool.name}`;
      toolRegistry.set(qualifiedName, {
        tool: { name: tool.name, description: tool.description, inputSchema: tool.inputSchema },
        serverName: serverConfig.name,
        config: serverConfig,
      });
    }
    log(`discovered ${tools.length} tools`);
  } catch (err) {
    log(`connection failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Gate-Intercepted Tool Execution ──────────────────────────────────────

async function executeToolCall(
  qualifiedName: string,
  args: Record<string, unknown>,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const entry = toolRegistry.get(qualifiedName);
  if (!entry) {
    return { content: [{ type: 'text', text: `Unknown tool: ${qualifiedName}` }], isError: true };
  }

  const { tool, serverName, config } = entry;
  const hasCredentials = config.connectionIds && config.connectionIds.length > 0;

  // Gate check: every tool call goes through policy evaluation
  let decision: GateDecision;
  try {
    decision = await callGate({
      toolName: `mcp:${serverName}:${tool.name}`,
      args,
      adapter: 'mcp-proxy',
    });
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Gate error: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }

  if (decision.decision === 'DENY') {
    return {
      content: [{ type: 'text', text: `Denied by policy: ${decision.reason ?? 'No reason given'}` }],
      isError: true,
    };
  }

  if (decision.decision === 'PENDING_APPROVAL') {
    return {
      content: [{ type: 'text', text: `Awaiting human approval (id: ${decision.approvalId}). Retry after approval.` }],
      isError: true,
    };
  }

  // Execution path splits based on whether credentials are involved
  if (hasCredentials) {
    // Layer 3: ephemeral container execution — creds resolved from vault, never leave container
    try {
      const result = await callGateStructuredExec({
        action: 'mcp:tool-call',
        params: {
          serverCommand: config.source,
          toolName: tool.name,
          toolArgs: args,
          connectionIds: config.connectionIds,
        },
      });

      if (!result.success) {
        return {
          content: [{ type: 'text', text: result.stderr || result.error || 'Secure execution failed' }],
          isError: true,
        };
      }

      try {
        const mcpResult = JSON.parse(result.stdout.trim().split('\n').pop() ?? '{}');
        return mcpResult;
      } catch {
        return { content: [{ type: 'text', text: result.stdout }] };
      }
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Secure exec error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  } else {
    // Non-credentialed: forward directly to upstream MCP server
    const client = upstreamClients.get(serverName);
    if (!client) {
      return { content: [{ type: 'text', text: `Upstream server ${serverName} not connected` }], isError: true };
    }

    try {
      const result = await client.callTool({ name: tool.name, arguments: args });
      return result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Upstream error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
}

// ── MCP Server Factory ───────────────────────────────────────────────────

function createMcpServerInstance(): McpServer {
  const server = new McpServer({
    name: 'wooblay-mcp-proxy',
    version: '0.1.0',
  });

  for (const [qualifiedName, { tool }] of toolRegistry) {
    const schemaShape: Record<string, any> = {};
    if (tool.inputSchema && typeof tool.inputSchema === 'object' && 'properties' in tool.inputSchema) {
      const props = (tool.inputSchema as any).properties ?? {};
      const required = new Set((tool.inputSchema as any).required ?? []);
      for (const [key] of Object.entries(props)) {
        schemaShape[key] = required.has(key) ? z.any() : z.any().optional();
      }
    }

    server.tool(
      qualifiedName,
      tool.description ?? `Tool from MCP server (${qualifiedName})`,
      Object.keys(schemaShape).length > 0 ? schemaShape : { _empty: z.any().optional() },
      async (args) => {
        const cleanArgs = { ...args };
        delete cleanArgs._empty;
        return executeToolCall(qualifiedName, cleanArgs);
      },
    );
  }

  return server;
}

// ── HTTP Server with SSE Transport ───────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig();
  process.stderr.write(`[proxy] Gate URL: ${config.gateUrl}\n`);
  process.stderr.write(`[proxy] Instance: ${config.instanceId}\n`);
  process.stderr.write(`[proxy] Servers: ${config.servers.length}\n`);

  // Connect to all upstream MCP servers
  await Promise.allSettled(config.servers.map(connectUpstream));
  process.stderr.write(`[proxy] Total tools discovered: ${toolRegistry.size}\n`);

  // Track active SSE transports for cleanup
  const activeTransports = new Map<string, SSEServerTransport>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    // Health check (unauthenticated — needed for Docker health checks)
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', tools: toolRegistry.size }));
      return;
    }

    // Defense-in-depth: verify bearer token on all non-health endpoints.
    // The primary isolation layer is Docker networking (expose, not ports),
    // but this catches misconfigurations where the port is accidentally published.
    if (PROXY_TOKEN) {
      const authHeader = req.headers['authorization'] ?? '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== PROXY_TOKEN) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
    }

    // SSE endpoint — agent connects here
    if (url.pathname === '/sse' && req.method === 'GET') {
      const server = createMcpServerInstance();
      const transport = new SSEServerTransport('/messages', res);
      activeTransports.set(transport.sessionId, transport);

      res.on('close', () => {
        activeTransports.delete(transport.sessionId);
      });

      await server.connect(transport);
      return;
    }

    // Message endpoint — agent sends JSON-RPC messages here
    if (url.pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'sessionId required' }));
        return;
      }

      const transport = activeTransports.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    process.stderr.write(`[proxy] MCP proxy listening on http://0.0.0.0:${PORT} (${toolRegistry.size} tools)\n`);
    process.stderr.write(`[proxy] Agent connect: GET http://mcp-proxy:${PORT}/sse\n`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    process.stderr.write('[proxy] Shutting down...\n');
    for (const [, client] of upstreamClients) {
      try { await client.close(); } catch { /* best effort */ }
    }
    httpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  // SIGHUP = config reload (fetch fresh config from Gate API)
  process.on('SIGHUP', async () => {
    process.stderr.write('[proxy] SIGHUP — reloading config from Gate...\n');
    const freshServers = config.instanceId
      ? await fetchConfigFromGate(config.gateUrl, config.instanceId)
      : loadConfig().servers;
    toolRegistry.clear();
    for (const [, client] of upstreamClients) {
      try { await client.close(); } catch { /* ignore */ }
    }
    upstreamClients.clear();
    await Promise.allSettled(freshServers.map(connectUpstream));
    process.stderr.write(`[proxy] Reloaded: ${toolRegistry.size} tools\n`);
  });
}

main().catch((err) => {
  process.stderr.write(`[proxy] Fatal: ${err}\n`);
  process.exit(1);
});
