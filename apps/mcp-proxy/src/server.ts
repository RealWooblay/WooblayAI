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
import { callGate, callGateStructuredExec, checkApprovalOnce } from './gate-interceptor.js';

const PORT = parseInt(process.env['MCP_PROXY_PORT'] ?? '3100', 10);
const PROXY_TOKEN = process.env['GATEWAY_TOKEN'] ?? '';

if (!PROXY_TOKEN) {
  console.error('[mcp-proxy] FATAL: GATEWAY_TOKEN is not set. Refusing to start without auth token.');
  process.exit(1);
}

// ── State ────────────────────────────────────────────────────────────────

const upstreamClients = new Map<string, Client>();
const toolRegistry = new Map<string, { tool: UpstreamTool; serverName: string; config: McpServerConfigEntry }>();

interface ServerStatus {
  name: string;
  status: 'connecting' | 'connected' | 'error';
  toolCount: number;
  error?: string;
}
const serverStatuses: ServerStatus[] = [];

// ── Deferred Approval Flow ───────────────────────────────────────────────
// When a tool call needs human approval, the proxy returns immediately with
// a pending status instead of blocking the agent. The call context is stored
// and the agent uses wooblay__check_approval to poll and retrieve the result
// once approved. This lets agents continue other work during approval waits.

interface DeferredToolCall {
  approvalId: string;
  qualifiedName: string;
  args: Record<string, unknown>;
  serverName: string;
  config: McpServerConfigEntry;
  tool: UpstreamTool;
  toolCallId?: string;
  createdAt: number;
}

// ── Upstream Connection ──────────────────────────────────────────────────

async function connectUpstream(serverConfig: McpServerConfigEntry): Promise<void> {
  if (!serverConfig.enabled) return;

  const log = (msg: string) => process.stderr.write(`[proxy:${serverConfig.name}] ${msg}\n`);
  const entry: ServerStatus = { name: serverConfig.name, status: 'connecting', toolCount: 0 };
  serverStatuses.push(entry);

  try {
    let transport;
    if (serverConfig.transport === 'stdio') {
      const parts = serverConfig.source.split(/\s+/);
      const safeEnv: Record<string, string> = {
        PATH: process.env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
        HOME: process.env['HOME'] ?? '/tmp',
        NODE_ENV: process.env['NODE_ENV'] ?? 'production',
      };
      log(`spawning: ${parts[0]} ${parts.slice(1).join(' ')}`);
      transport = new StdioClientTransport({
        command: parts[0],
        args: [...parts.slice(1), ...(serverConfig.args ?? [])],
        env: safeEnv,
      });
    } else {
      log(`connecting to SSE: ${serverConfig.source}`);
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
    entry.status = 'connected';
    entry.toolCount = tools.length;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`connection failed: ${msg}`);
    entry.status = 'error';
    entry.error = msg.slice(0, 500);
  }
}

async function reportStatusToGate(gateUrl: string, instanceId: string): Promise<void> {
  if (!instanceId || serverStatuses.length === 0) return;
  try {
    const token = process.env['GATEWAY_TOKEN'] ?? '';
    await fetch(`${gateUrl}/api/instances/${instanceId}/mcp-servers/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ servers: serverStatuses }),
      signal: AbortSignal.timeout(5_000),
    });
    process.stderr.write(`[proxy] Reported status for ${serverStatuses.length} server(s) to Gate\n`);
  } catch (err) {
    process.stderr.write(`[proxy] Failed to report status to Gate: ${err instanceof Error ? err.message : err}\n`);
  }
}

// ── Tool Execution (Approved Path) ───────────────────────────────────────

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/**
 * Execute a tool call that has already been approved (or doesn't need approval).
 * Splits between credentialed (L3 ephemeral container) and non-credentialed (direct upstream).
 */
async function executeApprovedToolCall(
  tool: UpstreamTool,
  serverName: string,
  config: McpServerConfigEntry,
  args: Record<string, unknown>,
  toolCallId?: string,
): Promise<ToolResult> {
  const hasCredentials = config.connectionIds && config.connectionIds.length > 0;

  if (hasCredentials) {
    try {
      const result = await callGateStructuredExec({
        action: 'mcp:tool-call',
        params: {
          serverCommand: config.source,
          toolName: tool.name,
          toolArgs: args,
          connectionIds: config.connectionIds,
          ...(toolCallId ? { toolCallId } : {}),
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
    const client = upstreamClients.get(serverName);
    if (!client) {
      return { content: [{ type: 'text', text: `Upstream server ${serverName} not connected` }], isError: true };
    }

    try {
      const result = await client.callTool({ name: tool.name, arguments: args });
      return result as ToolResult;
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Upstream error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  }
}

// ── Gate-Intercepted Tool Execution (Non-Blocking) ───────────────────────

/**
 * Execute a tool call through the Gate. On PENDING_APPROVAL, stores the call
 * context in the deferred map and returns immediately — the agent is NOT
 * blocked. It can continue other work and use wooblay__check_approval to
 * retrieve the result once a human decides.
 *
 * This is the key innovation: agents stay productive during human review.
 */
async function executeToolCall(
  qualifiedName: string,
  args: Record<string, unknown>,
  deferredCalls: Map<string, DeferredToolCall>,
): Promise<ToolResult> {
  const entry = toolRegistry.get(qualifiedName);
  if (!entry) {
    return { content: [{ type: 'text', text: `Unknown tool: ${qualifiedName}` }], isError: true };
  }

  const { tool, serverName, config } = entry;

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
    if (!decision.approvalId) {
      return { content: [{ type: 'text', text: 'Approval required but no approval ID returned.' }], isError: true };
    }

    // Store the call context for deferred execution
    deferredCalls.set(decision.approvalId, {
      approvalId: decision.approvalId,
      qualifiedName,
      args,
      serverName,
      config,
      tool,
      toolCallId: decision.toolCallId,
      createdAt: Date.now(),
    });

    const pendingCount = deferredCalls.size;
    process.stderr.write(`[proxy] Deferred tool call: ${tool.name} (approval: ${decision.approvalId}, ${pendingCount} pending)\n`);

    return {
      content: [{
        type: 'text',
        text: [
          `This action requires human approval before it can execute.`,
          ``,
          `Approval ID: ${decision.approvalId}`,
          `Action: ${tool.name}`,
          `Reason: ${decision.reason ?? 'Policy requires review for this action'}`,
          `Status: PENDING`,
          ``,
          `A reviewer has been notified. You can continue working on other tasks.`,
          `To check the status and retrieve the result once approved, call:`,
          `  wooblay__check_approval({ "approvalId": "${decision.approvalId}" })`,
          ``,
          `To see all pending approvals: wooblay__list_pending()`,
        ].join('\n'),
      }],
    };
  }

  // EXECUTE — approved by policy, run immediately
  return executeApprovedToolCall(tool, serverName, config, args, decision.toolCallId);
}

// ── MCP Server Factory ───────────────────────────────────────────────────

function createMcpServerInstance(): McpServer {
  const server = new McpServer({
    name: 'wooblay-mcp-proxy',
    version: '0.1.0',
  });

  // Per-session deferred call storage. Each SSE session gets its own map
  // so deferred calls are isolated between agent connections.
  const deferredCalls = new Map<string, DeferredToolCall>();

  // ── Register upstream tools ─────────────────────────────────────────
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
        return executeToolCall(qualifiedName, cleanArgs, deferredCalls);
      },
    );
  }

  // ── Wooblay System Tools ────────────────────────────────────────────
  // These are always available regardless of which upstream MCP servers
  // are configured. They let the agent manage the approval lifecycle
  // without blocking.

  server.tool(
    'wooblay__check_approval',
    'Check the status of a pending approval. If approved, executes the deferred tool call and returns the result. If still pending, returns the current status. Call this after receiving a PENDING_APPROVAL response to retrieve results once a reviewer decides.',
    { approvalId: z.string().describe('The approval ID returned by the original tool call') },
    async ({ approvalId }) => {
      const deferred = deferredCalls.get(approvalId as string);
      if (!deferred) {
        return {
          content: [{ type: 'text', text: `No pending approval found with ID: ${approvalId}. It may have already been resolved or expired.` }],
          isError: true,
        };
      }

      let status: string;
      try {
        status = await checkApprovalOnce(approvalId as string);
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to check approval status: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      if (status === 'PENDING') {
        const waitingSec = Math.round((Date.now() - deferred.createdAt) / 1000);
        return {
          content: [{
            type: 'text',
            text: `Approval ${approvalId} is still pending (waiting ${waitingSec}s). A reviewer has been notified. Check back shortly or continue with other tasks.`,
          }],
        };
      }

      if (status === 'DENIED') {
        deferredCalls.delete(approvalId as string);
        return {
          content: [{ type: 'text', text: `Approval ${approvalId} was denied by a reviewer. The action "${deferred.tool.name}" will not be executed.` }],
          isError: true,
        };
      }

      if (status === 'EXPIRED') {
        deferredCalls.delete(approvalId as string);
        return {
          content: [{ type: 'text', text: `Approval ${approvalId} expired — no reviewer responded in time. You may retry the original action.` }],
          isError: true,
        };
      }

      // APPROVED — execute the deferred tool call and return the real result
      deferredCalls.delete(approvalId as string);
      process.stderr.write(`[proxy] Executing deferred call: ${deferred.tool.name} (approval: ${approvalId})\n`);
      return executeApprovedToolCall(deferred.tool, deferred.serverName, deferred.config, deferred.args, deferred.toolCallId);
    },
  );

  server.tool(
    'wooblay__list_pending',
    'List all tool calls currently waiting for human approval in this session. Returns approval IDs, tool names, and how long each has been waiting.',
    { _empty: z.any().optional() },
    async () => {
      if (deferredCalls.size === 0) {
        return { content: [{ type: 'text', text: 'No pending approvals.' }] };
      }

      const lines = ['Pending approvals:', ''];
      for (const [id, deferred] of deferredCalls) {
        const waitingSec = Math.round((Date.now() - deferred.createdAt) / 1000);
        lines.push(`  - ${deferred.tool.name} (approval: ${id}, waiting: ${waitingSec}s)`);
      }
      lines.push('', `Use wooblay__check_approval({ "approvalId": "..." }) to check status and retrieve results.`);

      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

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

  await reportStatusToGate(config.gateUrl, config.instanceId);

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
