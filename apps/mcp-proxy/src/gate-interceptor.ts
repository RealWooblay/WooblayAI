/**
 * Gate Interceptor — routes every MCP tool call through the Wooblay Gate.
 *
 * Two paths:
 *   1. callGate()              — Policy check (L1+L2). Returns EXECUTE/DENY/PENDING_APPROVAL.
 *   2. callGateStructuredExec() — Layer 3 secure execution for credentialed tools.
 *      The Gate resolves credentials from vault connections, runs the tool
 *      in an ephemeral container, returns the result.
 *      The proxy NEVER sees credentials. They exist only inside the
 *      ephemeral container for the duration of one tool call.
 */

import type { GateDecision, StructuredExecRequest, StructuredExecResult } from './types.js';

const GATE_URL = () => process.env['GATE_URL'] ?? 'http://localhost:4800';
const GATEWAY_TOKEN = () => process.env['GATEWAY_TOKEN'] ?? '';

function authHeaders(): Record<string, string> {
  const token = GATEWAY_TOKEN();
  return token ? { 'Authorization': `Bearer ${token}` } : {};
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
      requestSignature: 'mcp-proxy', // Gate schema requires non-empty; auth is via GATEWAY_TOKEN
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
    throw new Error(`Secure execution failed (${res.status})`);
  }

  return await res.json() as StructuredExecResult;
}
