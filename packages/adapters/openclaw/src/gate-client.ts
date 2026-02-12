/**
 * Lightweight Gate client for the OpenClaw plugin adapter.
 * Uses native fetch — no external HTTP dependencies.
 * Communicates with Wooblay Gate's REST API.
 */

import type { ToolExecuteResponse } from '@wooblay/types';

export interface GateToolCallPayload {
  toolName: string;
  args: Record<string, unknown>;
  agentPubkey: string;
  requestSignature: string;
  adapter: string;
  taskId?: string;
  sessionId?: string;
}

export interface GateExecutionReport {
  toolCallId: string;
  status: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  artifactsMeta?: Record<string, unknown>;
}

export interface ApprovalStatus {
  id: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'EXPIRED';
  approver?: string;
  reason?: string;
}

export class PluginGateClient {
  private readonly baseUrl: string;

  constructor(gateUrl: string) {
    this.baseUrl = gateUrl.replace(/\/$/, '');
  }

  /**
   * Submit a tool call to Gate for policy evaluation.
   * Returns the Gate's decision: EXECUTE, DENY, or PENDING_APPROVAL.
   */
  async submitToolCall(payload: GateToolCallPayload): Promise<ToolExecuteResponse> {
    const res = await fetch(`${this.baseUrl}/api/tool/execute`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Wooblay Gate returned ${res.status}: ${body}`);
    }

    return res.json() as Promise<ToolExecuteResponse>;
  }

  /**
   * Report execution results back to Gate for receipt generation.
   */
  async reportExecution(report: GateExecutionReport): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/executions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(report),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Non-critical: log but don't throw — execution already happened
      console.error(`[wooblay] Failed to report execution: ${res.status} ${body}`);
    }
  }

  /**
   * Check the current status of an approval.
   */
  async getApprovalStatus(approvalId: string): Promise<ApprovalStatus> {
    const res = await fetch(`${this.baseUrl}/api/approvals/${approvalId}`, {
      headers: { 'content-type': 'application/json' },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Wooblay Gate approvals/${approvalId} returned ${res.status}: ${body}`);
    }

    return res.json() as Promise<ApprovalStatus>;
  }

  /**
   * Check if Gate is healthy and reachable.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
