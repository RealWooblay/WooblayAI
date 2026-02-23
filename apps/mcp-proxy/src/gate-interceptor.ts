/**
 * Gate Interceptor — routes every MCP tool call through the Wooblay Gate.
 *
 * Three paths:
 *   1. callGate()              — Policy check (L1+L2). Returns EXECUTE/DENY/PENDING_APPROVAL.
 *   2. waitForApproval()       — Polls Gate until a PENDING_APPROVAL is resolved.
 *   3. callGateStructuredExec() — Layer 3 secure execution for credentialed tools.
 *      The Gate resolves credentials from vault connections, runs the tool
 *      in an ephemeral container, returns the result.
 *      The proxy NEVER sees credentials. They exist only inside the
 *      ephemeral container for the duration of one tool call.
 */

import type { GateDecision, StructuredExecRequest, StructuredExecResult } from './types.js';

const GATE_URL = () => process.env['GATE_URL'] ?? 'http://localhost:4800';
const GATEWAY_TOKEN = () => process.env['GATEWAY_TOKEN'] ?? '';

const APPROVAL_POLL_INTERVAL_MS = 2_000;
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1_000; // 5 minutes

function authHeaders(): Record<string, string> {
  const token = GATEWAY_TOKEN();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface GateToolRequest {
  toolName: string;
  args: Record<string, unknown>;
  adapter: string;
}

/**
 * Submit a tool call to the Gate for policy evaluation.
 */
export async function callGate(req: GateToolRequest): Promise<GateDecision> {
  const res = await fetch(`${GATE_URL()}/api/tool/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      toolName: req.toolName,
      args: req.args,
      adapter: req.adapter,
      agentPubkey: 'mcp-proxy',
      requestSignature: 'mcp-proxy',
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const msg = body ? `Gate policy check failed (${res.status}): ${body.slice(0, 200)}` : `Gate policy check failed (${res.status})`;
    throw new Error(msg);
  }

  return await res.json() as GateDecision;
}

interface ApprovalResponse {
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
}

/**
 * Poll Gate for an approval decision. Holds execution until the human
 * approves/denies in the UI, or the timeout expires.
 *
 * MCP over SSE is async — Cursor/Claude Desktop will wait for the tool
 * result without dropping the connection, so this is safe to hold open.
 */
export async function waitForApproval(approvalId: string): Promise<'APPROVED' | 'DENIED' | 'EXPIRED'> {
  const log = (msg: string) => process.stderr.write(`[gate:approval:${approvalId}] ${msg}\n`);
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  log('waiting for human decision...');

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${GATE_URL()}/api/approvals/${approvalId}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(10_000),
      });

      if (res.ok) {
        const data = await res.json() as ApprovalResponse;
        if (data.status === 'APPROVED' || data.status === 'DENIED' || data.status === 'EXPIRED') {
          log(`resolved: ${data.status}`);
          return data.status;
        }
      }
    } catch (err) {
      log(`poll error (will retry): ${err instanceof Error ? err.message : err}`);
    }

    await sleep(APPROVAL_POLL_INTERVAL_MS);
  }

  log('timed out waiting for decision');
  return 'EXPIRED';
}

/**
 * Single-shot approval status check. Returns immediately without polling.
 * Used by the non-blocking approval flow: agent calls wooblay__check_approval,
 * which checks once and either returns the status or executes if approved.
 */
export async function checkApprovalOnce(approvalId: string): Promise<'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED'> {
  const res = await fetch(`${GATE_URL()}/api/approvals/${approvalId}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Failed to check approval status: ${res.status}`);
  }

  const data = await res.json() as ApprovalResponse;
  return data.status;
}

/**
 * Execute a credentialed tool call via Layer 3 secure execution.
 *
 * The Gate:
 *   1. Resolves credentials from vault connections (by provider match)
 *   2. Runs the action in an ephemeral container with creds injected as env vars
 *   3. Captures the result
 *   4. Destroys the container
 *
 * Credentials never transit through the proxy.
 */
export async function callGateStructuredExec(req: StructuredExecRequest): Promise<StructuredExecResult> {
  const res = await fetch(`${GATE_URL()}/api/tool/structured-execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(req),
    signal: AbortSignal.timeout(150_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Secure execution failed (${res.status}): ${body.slice(0, 500)}`);
  }

  return await res.json() as StructuredExecResult;
}
