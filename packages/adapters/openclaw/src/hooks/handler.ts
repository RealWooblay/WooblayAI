/**
 * OpenClaw Hook Handler — Wooblay Gate Enforcement
 *
 * IMPORTANT: This file must be SELF-CONTAINED — no external imports.
 * OpenClaw loads hooks as single handler.ts files and does not resolve
 * package imports from the hooks directory.
 *
 * Every tool call — from any source (built-in, plugin, MCP server) —
 * is routed through Wooblay Gate for policy evaluation:
 *
 *   - tool:start → submits to Gate. Gate decides ALLOW / DENY / APPROVE.
 *                   If DENY, throws to abort execution.
 *                   If Gate unreachable, blocks (fail-safe).
 *   - tool:result → reports execution outcome for receipt chain + audit trail.
 *   - command:new/stop → audit trail for session lifecycle.
 *
 * No skip lists. No hardcoded exceptions. Every action goes through Gate.
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
    // Re-throw policy denials — this is how we block tool execution
    if (err instanceof PolicyDeniedError) {
      throw err;
    }
    console.error(
      '[wooblay-hook] Error:',
      err instanceof Error ? err.message : String(err),
    );
  }
};

// ── Policy Denied Error ─────────────────────────────────────────────────

class PolicyDeniedError extends Error {
  constructor(toolName: string, reason: string) {
    super(`[Wooblay] BLOCKED: ${toolName} — ${reason}`);
    this.name = 'PolicyDeniedError';
  }
}

// ── Tool Event Handler ──────────────────────────────────────────────────

async function handleToolEvent(event: HookEvent): Promise<void> {
  const { action, context, sessionKey } = event;
  const toolName = context.toolName ?? 'unknown';
  const toolCallId = context.toolCallId;

  switch (action) {
    case 'start': {
      console.log(
        `[wooblay-hook] tool:start — ${toolName} (id: ${toolCallId}) session: ${sessionKey}`,
      );

      // Submit to Gate for policy evaluation
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

      // ENFORCE: If Gate says DENY, throw to abort the tool execution
      if (decision?.decision === 'DENY') {
        const reason = (decision.reason as string) ?? 'Blocked by policy';
        console.log(`[wooblay-hook] BLOCKED: ${toolName} — ${reason}`);
        throw new PolicyDeniedError(toolName, reason);
      }

      // If Gate is unreachable (decision is null), fail-safe: block risky tools
      if (decision === null) {
        console.log(`[wooblay-hook] BLOCKED (fail-safe): ${toolName} — Gate unreachable`);
        throw new PolicyDeniedError(toolName, 'Wooblay Gate unreachable — action blocked for safety');
      }

      // PENDING_APPROVAL is logged but not blocked here — the gated tools handle approval polling.
      // If a built-in tool reaches here with PENDING, we block (it shouldn't be using built-ins).
      if (decision?.decision === 'PENDING_APPROVAL') {
        console.log(`[wooblay-hook] BLOCKED: ${toolName} — requires approval (use gated tools)`);
        throw new PolicyDeniedError(
          toolName,
          `Requires human approval (approval ID: ${decision.approvalId}). Use gated tools for approval flow.`,
        );
      }

      // EXECUTE — allowed, continue
      console.log(`[wooblay-hook] ALLOWED: ${toolName}`);
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
