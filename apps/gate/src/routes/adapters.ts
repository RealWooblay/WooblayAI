/**
 * Adapter routes.
 *
 * GET /api/adapters — Returns the list of available adapter descriptors
 * with integration instructions for each.
 */

import type { FastifyInstance } from 'fastify';
import { ADAPTERS } from '@wooblay/types';

/** Quick-start code snippets for each adapter type. */
const INTEGRATION_SNIPPETS: Record<string, { language: string; code: string; notes: string }> = {
  'http-sdk': {
    language: 'bash',
    code: `curl -X POST http://localhost:4800/api/tool/execute \\
  -H "Content-Type: application/json" \\
  -d '{"toolName":"exec","args":{"command":"ls -la"},"agentPubkey":"your-pubkey","adapter":"http-sdk","taskId":"task-1","sessionId":"session-1"}'`,
    notes: 'Returns { decision: "EXECUTE" | "DENY" | "PENDING_APPROVAL", approvalId?: string }. If PENDING_APPROVAL, poll GET /api/approvals/{approvalId} until resolved.',
  },
  'openclaw-plugin': {
    language: 'bash',
    code: `# Pre-installed in managed runtimes.
# For manual setup:
cp -r packages/adapters/openclaw/plugin ~/.openclaw/plugins/wooblay/
cp docker/runtimes/openclaw/exec-approvals.json ~/.openclaw/
export GATE_URL=http://localhost:4800`,
    notes: 'The plugin hooks into OpenClaw exec approvals and routes all tool calls through Wooblay Gate. 24-hour deferred approval window supported.',
  },
  'mcp-toolhost': {
    language: 'json',
    code: `{
  "mcpServers": {
    "wooblay": {
      "command": "npx",
      "args": ["@wooblay/mcp-toolhost", "--gate", "http://localhost:4800"]
    }
  }
}`,
    notes: 'Add to your MCP client configuration (e.g. Claude Desktop). The toolhost wraps tools and routes them through Gate.',
  },
};

export async function adapterRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/adapters
   * Returns all registered adapter descriptors with integration snippets.
   */
  app.get('/api/adapters', async (_request, reply) => {
    const enriched = ADAPTERS.map((adapter) => ({
      ...adapter,
      integration: INTEGRATION_SNIPPETS[adapter.id] ?? null,
    }));
    return reply.code(200).send(enriched);
  });
}
