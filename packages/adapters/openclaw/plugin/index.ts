/**
 * Wooblay OpenClaw Plugin — Policy Enforcement via Tool Override
 *
 * Registers gated tools under BOTH built-in and explicit names (e.g. "exec"
 * AND "gated_exec"). This overrides OpenClaw's built-in risky tools so every
 * execution goes through Wooblay Gate for AI risk classification + policy.
 *
 * FLOW:
 *   Agent calls exec("rm -rf /tmp")
 *     → Plugin POSTs to Gate /api/tool/execute
 *     → Gate: structural risk classification + AI analysis
 *     → Gate: policy evaluation → EXECUTE / DENY / PENDING_APPROVAL
 *     → EXECUTE: plugin runs command locally, returns output
 *     → DENY: plugin returns "BLOCKED by policy" to agent
 *     → PENDING: plugin polls Gate for human approval, then executes or blocks
 *
 * For credentialed external actions (git push, deploy):
 *   Agent calls structured_action({ action: "git:push", params: { ... } })
 *     → Plugin POSTs to Gate /api/tool/execute for policy
 *     → If approved, POSTs to /api/tool/structured-execute
 *     → Gate runs three-layer moat: scope → simulation → ephemeral container
 *     → Agent never sees credentials
 */

// ─── Gate HTTP Client ────────────────────────────────────────────────────────

async function askGate(
  gateUrl: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ decision: string; approvalId?: string; reason?: string; toolCallId?: string; receiptId?: string }> {
  const res = await fetch(`${gateUrl}/api/tool/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      toolName,
      args,
      agentPubkey: 'openclaw-runtime',
      requestSignature: 'wooblay-plugin-v5',
      adapter: 'openclaw-plugin-v5',
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gate ${res.status}: ${text}`);
  }
  return res.json();
}

async function waitForApproval(
  gateUrl: string,
  approvalId: string,
  timeoutMs: number = 100_000,
  pollMs: number = 2_000,
): Promise<'APPROVED' | 'DENIED' | 'TIMEOUT'> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${gateUrl}/api/approvals/${approvalId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'APPROVED') return 'APPROVED';
        if (data.status === 'DENIED') return 'DENIED';
        if (data.status === 'EXPIRED') return 'DENIED';
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return 'TIMEOUT';
}

async function gateHealth(gateUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${gateUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Tool Execution Helpers ──────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: 'text'; text: string }> };

function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

async function gatedAction(
  gateUrl: string,
  toolName: string,
  args: Record<string, unknown>,
  executeFn: () => Promise<string>,
  logger: { info: (...a: any[]) => void; error: (...a: any[]) => void },
): Promise<ToolResult> {
  try {
    const decision = await askGate(gateUrl, toolName, args);

    if (decision.decision === 'EXECUTE') {
      logger.info(`[wooblay] ALLOWED: ${toolName} — ${JSON.stringify(args).slice(0, 200)}`);
      const output = await executeFn();
      return textResult(output);
    }

    if (decision.decision === 'DENY') {
      logger.info(`[wooblay] BLOCKED: ${toolName} — ${decision.reason}`);
      return textResult(`BLOCKED by Wooblay policy: ${decision.reason}`);
    }

    if (decision.decision === 'PENDING_APPROVAL' && decision.approvalId) {
      logger.info(`[wooblay] PENDING: ${toolName} — waiting for approval (${decision.approvalId})`);
      const result = await waitForApproval(gateUrl, decision.approvalId);

      if (result === 'APPROVED') {
        logger.info(`[wooblay] APPROVED: ${toolName}`);
        const output = await executeFn();
        return textResult(output);
      }

      logger.info(`[wooblay] NOT APPROVED (${result}): ${toolName}`);
      return textResult(
        `This action requires human approval. ` +
        `Approval ID: ${decision.approvalId}. ` +
        `Check the Wooblay dashboard to approve or deny.`
      );
    }

    return textResult(`Unknown Gate decision: ${decision.decision}`);
  } catch (err: any) {
    logger.error(`[wooblay] Gate error for ${toolName}: ${err.message}`);
    return textResult(`Wooblay Gate unreachable — action blocked for safety. Error: ${err.message}`);
  }
}

// ─── Plugin Entry Point ──────────────────────────────────────────────────────

interface PluginApi {
  config: Record<string, any>;
  logger: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
  registerTool?: (tool: Record<string, any>) => void;
  registerService?: (service: { id: string; start: () => void; stop: () => void }) => void;
  registerGatewayMethod?: (method: string, handler: (...args: any[]) => void) => void;
  registerCommand?: (opts: Record<string, any>) => void;
}

export default function register(api: PluginApi): void {
  const logger = api.logger ?? console;
  const pluginConfig = api.config?.plugins?.entries?.wooblay?.config ?? {};
  const gateUrl: string = pluginConfig.gateUrl
    ?? process.env['GATE_URL']
    ?? process.env['WOOBLAY_GATE_URL']
    ?? 'http://wooblay-gate:4800';

  logger.info('[wooblay] v5 plugin loading (gated tools via registerTool)');
  logger.info(`[wooblay] Gate URL: ${gateUrl}`);

  if (!api.registerTool) {
    logger.error('[wooblay] FATAL: api.registerTool not available — plugin cannot register gated tools');
    return;
  }

  // ── GATED TOOLS ────────────────────────────────────────────────────────────
  //
  // Each tool is registered TWICE:
  //   1. Under the built-in name (e.g. "exec") — overrides OpenClaw's built-in
  //   2. Under the gated name (e.g. "gated_exec") — explicit gated version
  //
  // This ensures that no matter which name the agent uses, the call goes
  // through Wooblay Gate for AI risk classification + policy evaluation.

  // Helper to register a tool under multiple names
  const registerGatedTool = (names: string[], tool: Omit<Record<string, any>, 'name'>) => {
    for (const name of names) {
      api.registerTool!({ ...tool, name });
    }
  };

  // 1. exec — shell command execution
  registerGatedTool(['exec', 'gated_exec'], {
    description: 'Execute a shell command. All commands are reviewed by Wooblay policy before execution.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
    async execute(_id: string, params: { command: string; cwd?: string; timeout?: number }) {
      return gatedAction(gateUrl, 'exec', params, async () => {
        const { execSync } = await import('child_process');
        const timeout = params.timeout ?? 30_000;
        return execSync(params.command, {
          cwd: params.cwd,
          timeout,
          encoding: 'utf-8',
          maxBuffer: 2 * 1024 * 1024,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      }, logger);
    },
  });

  // 2. write — write file contents
  registerGatedTool(['write', 'gated_write'], {
    description: 'Write content to a file. Reviewed by Wooblay policy before writing.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to write to' },
        content: { type: 'string', description: 'Content to write' },
      },
      required: ['path', 'content'],
    },
    async execute(_id: string, params: { path: string; content: string }) {
      return gatedAction(gateUrl, 'write', params, async () => {
        const fs = await import('fs');
        const path = await import('path');
        const dir = path.dirname(params.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(params.path, params.content, 'utf-8');
        return `File written: ${params.path} (${params.content.length} chars)`;
      }, logger);
    },
  });

  // 3. edit — edit a file (read, apply changes, write back)
  registerGatedTool(['edit', 'gated_edit'], {
    description: 'Edit a file by replacing old text with new text. Reviewed by Wooblay policy.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to edit' },
        old_string: { type: 'string', description: 'Text to find and replace' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
    async execute(_id: string, params: { path: string; old_string: string; new_string: string }) {
      return gatedAction(gateUrl, 'edit', params, async () => {
        const fs = await import('fs');
        const content = fs.readFileSync(params.path, 'utf-8');
        if (!content.includes(params.old_string)) {
          throw new Error(`old_string not found in ${params.path}`);
        }
        const updated = content.replace(params.old_string, params.new_string);
        fs.writeFileSync(params.path, updated, 'utf-8');
        return `File edited: ${params.path}`;
      }, logger);
    },
  });

  // 4. web_fetch — fetch a URL with optional custom headers
  registerGatedTool(['web_fetch', 'gated_web_fetch'], {
    description:
      'Fetch content from a URL with optional headers. Use headers for Authorization, API keys, etc. ' +
      'Agent-accessible secrets are available as environment variables (e.g. $MY_API_KEY). ' +
      'Reviewed by Wooblay policy.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        method: { type: 'string', description: 'HTTP method (default: GET)' },
        body: { type: 'string', description: 'Request body (for POST/PUT)' },
        headers: { type: 'object', description: 'HTTP headers as key-value pairs (e.g. { "Authorization": "Bearer $MY_API_KEY" })' },
      },
      required: ['url'],
    },
    async execute(_id: string, params: { url: string; method?: string; body?: string; headers?: Record<string, string> }) {
      return gatedAction(gateUrl, 'web_fetch', params, async () => {
        const resolvedHeaders: Record<string, string> = {};

        // Resolve env var references in headers (e.g. "$MY_API_KEY" → actual value)
        if (params.headers) {
          for (const [k, v] of Object.entries(params.headers)) {
            resolvedHeaders[k] = v.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_match, name) => {
              return process.env[name] ?? `$${name}`;
            });
          }
        }

        if (params.body && !resolvedHeaders['content-type'] && !resolvedHeaders['Content-Type']) {
          resolvedHeaders['content-type'] = 'application/json';
        }

        const res = await fetch(params.url, {
          method: params.method ?? 'GET',
          body: params.body,
          headers: Object.keys(resolvedHeaders).length > 0 ? resolvedHeaders : undefined,
        });

        const statusLine = `HTTP ${res.status} ${res.statusText}`;
        const text = await res.text();
        return `${statusLine}\n${text.slice(0, 50_000)}`;
      }, logger);
    },
  });

  // 5. structured_action — secure execution for credentialed external actions
  //    Agent declares WHAT it wants; Wooblay decides HOW to do it safely.
  //    Goes through the three-layer moat: scope → simulation → ephemeral execution.
  api.registerTool({
    name: 'structured_action',
    description:
      'Execute any action via Wooblay secure execution environment. ' +
      'Use this when you need credentials or exec_only secrets for ANY provider. ' +
      'The action runs in an ephemeral container — you never see credentials. ' +
      'Provide the command, specify the provider (matches a connected provider on the Connections page), ' +
      'and optionally a Docker image. Wooblay resolves credentials from the vault and injects them. ' +
      'Use list_secrets to discover available credentials before calling this. ' +
      'Example: { action: "exec:run", params: { command: "curl -X POST https://api.example.com/v1/charges -d amount=5000", provider: "stripe" } }',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'Action identifier. Use "exec:run" to execute any command in a secure container with provider credentials. ' +
            'Or use a descriptive name like "deploy:staging", "db:migrate" — Wooblay routes all through the same secure execution pipeline.',
        },
        params: {
          type: 'object',
          description:
            'Action parameters. Key fields: command (the command to run), provider (which connected provider\'s credentials to use), ' +
            'image (Docker image, default: node:20-slim), timeout (ms, max 600000), mountWorkspace (bool, mount agent workspace read-only).',
        },
      },
      required: ['action', 'params'],
    },
    async execute(_id: string, params: { action: string; params: Record<string, unknown> }) {
      return gatedAction(gateUrl, `structured_action:${params.action}`, params, async () => {
        // Once policy approves, call the gateway to execute via three-layer moat.
        // The gateway handles: scope check → simulation → ephemeral container execution.
        const res = await fetch(`${gateUrl}/api/tool/structured-execute`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: params.action,
            params: params.params,
            agentPubkey: 'openclaw-runtime',
            adapter: 'openclaw-plugin-v5',
          }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return `Secure execution failed (${res.status}): ${text}`;
        }

        const result = await res.json() as any;
        if (!result.success) {
          const parts = [`Action failed: ${result.error ?? 'unknown error'}`];
          if (result.stderr) parts.push(`stderr: ${result.stderr}`);
          if (result.simulation && !result.simulation.passed) {
            parts.push(`Simulation failed: ${result.simulation.summary}`);
          }
          return parts.join('\n');
        }

        const parts = [`Action succeeded: ${result.data?.description ?? params.action}`];
        if (result.data?.stdout) parts.push(result.data.stdout);
        if (result.simulation) parts.push(`Simulation: ${result.simulation.summary}`);
        return parts.join('\n');
      }, logger);
    },
  });

  // 6. list_secrets — discover available secrets and their visibility modes
  api.registerTool({
    name: 'list_secrets',
    description:
      'List all available secrets across connections. Returns secret names and modes: ' +
      '"agent" secrets are in your environment as $KEY_NAME. ' +
      '"exec_only" secrets are only available inside structured_action ephemeral containers. ' +
      'Use this to discover what credentials are available before making API calls or running exec:run.',
    parameters: {
      type: 'object',
      properties: {},
    },
    async execute() {
      try {
        const res = await fetch(`${gateUrl}/api/connections/secrets/names`, {
          headers: { 'content-type': 'application/json' },
        });
        if (!res.ok) {
          return textResult(`Failed to list secrets: ${res.status}`);
        }
        const data = await res.json() as { secrets: { key: string; mode: string; provider: string; connectionName: string }[] };
        if (!data.secrets?.length) {
          return textResult('No secrets configured. Add secrets on the Connections page in the Wooblay dashboard.');
        }
        const lines = data.secrets.map((s: any) => {
          const access = s.mode === 'agent'
            ? `env var $${s.key} (available now)`
            : `exec_only (use via structured_action/exec:run)`;
          return `- ${s.key} [${s.provider}/${s.connectionName}]: ${access}`;
        });
        return textResult(`Available secrets:\n${lines.join('\n')}`);
      } catch (err: any) {
        return textResult(`Failed to list secrets: ${err.message}`);
      }
    },
  });

  logger.info('[wooblay] Registered gated tools: exec/gated_exec, write/gated_write, edit/gated_edit, web_fetch/gated_web_fetch, structured_action, list_secrets');

  // ── HEALTH CHECK SERVICE ───────────────────────────────────────────────────

  if (api.registerService) {
    let healthInterval: ReturnType<typeof setInterval> | null = null;
    api.registerService({
      id: 'wooblay-health',
      start: () => {
        healthInterval = setInterval(async () => {
          const ok = await gateHealth(gateUrl);
          if (!ok) logger.warn('[wooblay] Gate health check FAILED — gated tools will block all actions');
        }, 30_000);
        logger.info('[wooblay] Health check service started (every 30s)');
      },
      stop: () => {
        if (healthInterval) clearInterval(healthInterval);
        logger.info('[wooblay] Health check service stopped');
      },
    });
  }

  // ── SLASH COMMAND ──────────────────────────────────────────────────────────

  if (api.registerCommand) {
    api.registerCommand({
      name: 'wooblay',
      description: 'Show Wooblay supervision status',
      handler: async () => {
        const healthy = await gateHealth(gateUrl);
        return {
          text: healthy
            ? `Wooblay supervision ACTIVE.\nGate: ${gateUrl}\nAll risky tools gated (exec, write, edit, web_fetch + structured_action)`
            : `Wooblay Gate UNREACHABLE at ${gateUrl}.\nAll tool calls will be BLOCKED for safety.`,
        };
      },
    });
  }

  // ── GATEWAY RPC ────────────────────────────────────────────────────────────

  if (api.registerGatewayMethod) {
    api.registerGatewayMethod('wooblay.status', async ({ respond }: any) => {
      const healthy = await gateHealth(gateUrl);
      respond(true, { ok: healthy, gateUrl, version: 'v5', strategy: 'gated-tools' });
    });
  }

  logger.info('[wooblay] Plugin loaded — built-in risky tools overridden, all routed through Wooblay Gate');
}
