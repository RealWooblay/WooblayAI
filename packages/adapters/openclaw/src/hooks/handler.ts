/**
 * OpenClaw Hook Handler for Wooblay Audit & Logging
 *
 * IMPORTANT: This file must be SELF-CONTAINED — no external imports.
 * OpenClaw loads hooks as single handler.ts files and does not resolve
 * package imports from the hooks directory.
 *
 * This hook listens to tool lifecycle events for audit logging and
 * receipt generation via Wooblay Gate's REST API.
 *
 * Events:
 *   - tool:start   — log when a tool call begins
 *   - tool:result   — log results + trigger receipt generation
 *   - command:new    — log session resets (audit trail)
 *   - command:stop   — log session stops
 */

// ── Inline Gate client (no external imports) ────────────────────────────

const GATE_URL = process.env['GATE_URL'] ?? process.env['WOOBLAY_GATE_URL'] ?? 'http://localhost:4800';

async function gatePost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${GATE_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function gateGet(path: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${GATE_URL}${path}`);
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── Types (inline) ──────────────────────────────────────────────────────

interface HookEvent {
  type: 'command' | 'session' | 'agent' | 'gateway' | 'tool';
  action: string;
  sessionKey: string;
  timestamp: Date;
  messages: string[];
  context: {
    runId?: string;
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    partialResult?: unknown;
    result?: unknown;
    isError?: boolean;
    sessionEntry?: unknown;
    sessionId?: string;
    sessionFile?: string;
    commandSource?: string;
    senderId?: string;
    workspaceDir?: string;
    sessionMeta?: {
      agentId: string;
      platform: string;
      channelType: string;
      channelId: string;
    };
    cfg?: unknown;
  };
}

// ── State ───────────────────────────────────────────────────────────────

/**
 * Map OpenClaw's toolCallId → Wooblay's toolCallId for correlation
 * between tool:start and tool:result events.
 */
const toolCallMap = new Map<string, string>();

// ── Handler ─────────────────────────────────────────────────────────────

const handler = async (event: HookEvent): Promise<void> => {
  try {
    switch (event.type) {
      case 'tool':
        await handleToolEvent(event);
        break;
      case 'command':
        handleCommandEvent(event);
        break;
      default:
        break;
    }
  } catch (err) {
    console.error(
      '[wooblay-hook] Error:',
      err instanceof Error ? err.message : String(err),
    );
  }
};

async function handleToolEvent(event: HookEvent): Promise<void> {
  const { action, context, sessionKey } = event;
  const toolName = context.toolName ?? 'unknown';
  const toolCallId = context.toolCallId;

  switch (action) {
    case 'start': {
      console.log(
        `[wooblay-hook] tool:start — ${toolName} (id: ${toolCallId}) session: ${sessionKey}`,
      );

      // Submit to Gate as an observation (fire-and-forget)
      const decision = await gatePost('/api/tool/execute', {
        toolName,
        args: (context.args as Record<string, unknown>) ?? {},
        agentPubkey: 'hook-observer',
        requestSignature: 'hook-audit',
        adapter: 'openclaw-hook',
        taskId: context.sessionMeta?.agentId ?? 'openclaw-agent',
        sessionId: sessionKey,
      });

      if (toolCallId && decision?.toolCallId) {
        toolCallMap.set(toolCallId, decision.toolCallId as string);
      }
      break;
    }

    case 'result': {
      console.log(
        `[wooblay-hook] tool:result — ${toolName} (id: ${toolCallId}) error: ${context.isError ?? false}`,
      );

      const wooblayToolCallId = toolCallId ? toolCallMap.get(toolCallId) : undefined;

      if (wooblayToolCallId) {
        toolCallMap.delete(toolCallId!);

        await gatePost('/api/executions', {
          toolCallId: wooblayToolCallId,
          status: context.isError ? 'FAILED' : 'COMPLETED',
          stdout: truncateResult(context.result),
          exitCode: context.isError ? 1 : 0,
          artifactsMeta: {
            toolName,
            adapter: 'openclaw-hook',
            openclawToolCallId: toolCallId,
            sessionKey,
          },
        });
      }
      break;
    }

    case 'update':
      // Progress updates — future enhancement
      break;
  }
}

function handleCommandEvent(event: HookEvent): void {
  const { action, sessionKey, context } = event;
  console.log(
    `[wooblay-hook] command:${action} — session: ${sessionKey} source: ${context.commandSource ?? 'unknown'}`,
  );
}

function truncateResult(result: unknown): string {
  if (result === undefined || result === null) return '';
  const str = typeof result === 'string' ? result : JSON.stringify(result);
  if (str.length <= 10_000) return str;
  return str.slice(0, 10_000) + '\n[truncated]';
}

export default handler;
