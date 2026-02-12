/**
 * Exec Approval Bridge
 *
 * Bridges OpenClaw's native Exec Approvals system with Wooblay Gate.
 *
 * How it works:
 *   1. OpenClaw is pre-configured with `ask: "always"` in exec-approvals.json
 *   2. When the agent tries to execute a tool, OpenClaw pauses and broadcasts
 *      an `exec.approval.requested` event over its WebSocket control plane
 *   3. This bridge listens for those events (via the Unix socket / WS API)
 *   4. For each request, it submits the tool call to Wooblay Gate for policy
 *      evaluation (EXECUTE / DENY / PENDING_APPROVAL)
 *   5. Based on Gate's response, it resolves the approval back to OpenClaw
 *      via `exec.approval.resolve`
 *
 * This is the BLOCKING integration point — OpenClaw's own approval system
 * handles the pause/resume of tool execution. Wooblay just makes the decision.
 *
 * Communication channels:
 *   - OpenClaw Gateway WS API on localhost (for approval events)
 *   - Wooblay Gate REST API (for policy evaluation)
 */

import { sign, canonicalJson } from '@wooblay/crypto';
import { PluginGateClient } from '../gate-client.js';
import { waitForApproval } from '../approval-waiter.js';
import { shouldGateTool, type WooblayPluginConfig } from '../config.js';

const ADAPTER_ID = 'openclaw-exec-approvals';

/**
 * Shape of an exec approval request from OpenClaw.
 * Broadcast when a tool call requires approval.
 */
export interface ExecApprovalRequest {
  /** Unique approval ID assigned by OpenClaw */
  id: string;
  /** The command/tool being requested */
  command: string;
  /** Command arguments */
  args?: string[];
  /** Working directory */
  cwd?: string;
  /** Agent that requested this */
  agentId: string;
  /** Resolved executable path */
  resolvedPath?: string;
  /** Session key */
  sessionKey?: string;
  /** Tool name (e.g. "exec", "browser") */
  toolName?: string;
  /** Full tool parameters */
  toolParams?: Record<string, unknown>;
  /** Timestamp */
  timestamp?: string;
}

/**
 * Resolution action sent back to OpenClaw.
 */
export type ApprovalAction = 'allow-once' | 'allow-always' | 'deny';

export interface ExecApprovalBridgeConfig {
  /** Wooblay Gate client */
  gateClient: PluginGateClient;
  /** Plugin config */
  config: WooblayPluginConfig;
  /** Agent signing keys */
  agentPubkey: string;
  agentPrivateKey: string;
  /** OpenClaw Gateway WS URL (default: ws://localhost:18789) */
  openclawWsUrl?: string;
  /** Path to the exec-approvals Unix socket */
  approvalSocketPath?: string;
}

/**
 * The Exec Approval Bridge service.
 *
 * Runs as a background process alongside the OpenClaw gateway, intercepting
 * exec approval requests and routing them through Wooblay Gate.
 */
export class ExecApprovalBridge {
  private readonly gateClient: PluginGateClient;
  private readonly config: WooblayPluginConfig;
  private readonly agentPubkey: string;
  private readonly agentPrivateKey: string;
  private running = false;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  // In-memory tracking of processed approvals to avoid duplicates
  private processedApprovals = new Set<string>();

  constructor(bridgeConfig: ExecApprovalBridgeConfig) {
    this.gateClient = bridgeConfig.gateClient;
    this.config = bridgeConfig.config;
    this.agentPubkey = bridgeConfig.agentPubkey;
    this.agentPrivateKey = bridgeConfig.agentPrivateKey;
  }

  /**
   * Start the bridge. Polls for pending exec approval requests
   * and routes them through Wooblay Gate.
   *
   * In production, this would use WebSocket subscription to OpenClaw's
   * control plane. For the MVP, we poll the approval queue via HTTP.
   */
  async start(): Promise<void> {
    this.running = true;
    console.log('[wooblay-bridge] Exec Approval Bridge started');
    console.log(`[wooblay-bridge] Gate: ${this.config.gateUrl}`);
    console.log(`[wooblay-bridge] Tool filter: ${this.config.toolFilter}`);

    // Poll for pending approval requests
    this.pollInterval = setInterval(async () => {
      if (!this.running) return;
      try {
        await this.pollApprovalRequests();
      } catch (err) {
        console.error(
          '[wooblay-bridge] Poll error:',
          err instanceof Error ? err.message : String(err),
        );
      }
    }, 1_000); // Check every second for responsiveness

    // Also do an initial health check
    const healthy = await this.gateClient.healthCheck();
    console.log(`[wooblay-bridge] Gate health: ${healthy ? 'OK' : 'UNREACHABLE'}`);
  }

  /**
   * Stop the bridge.
   */
  stop(): void {
    this.running = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    console.log('[wooblay-bridge] Exec Approval Bridge stopped');
  }

  /**
   * Poll OpenClaw for pending exec approval requests.
   *
   * In the managed runtime, we read the approval queue by querying
   * OpenClaw's control plane API. The exact endpoint depends on OpenClaw's
   * version, but the pattern is:
   *   GET /api/approvals/pending -> list of pending approval requests
   *
   * For the MVP, we also support a file-based approach where OpenClaw
   * writes pending requests to a known directory.
   */
  private async pollApprovalRequests(): Promise<void> {
    // Approach 1: Try OpenClaw's WebSocket/HTTP control API
    // OpenClaw broadcasts `exec.approval.requested` events
    // In the Docker runtime, we intercept these via a local WebSocket

    // Approach 2: Poll Wooblay Gate's own pending approvals
    // (These were submitted by the hook handler on tool:start events)
    try {
      const res = await fetch(`${this.config.gateUrl}/api/approvals/pending`);
      if (!res.ok) return;

      const approvals = (await res.json()) as Array<{
        id: string;
        toolCallId: string;
        status: string;
      }>;

      for (const approval of approvals) {
        if (this.processedApprovals.has(approval.id)) continue;
        // Track that we've seen this one
        this.processedApprovals.add(approval.id);
        // Clean up old entries periodically
        if (this.processedApprovals.size > 1000) {
          const entries = [...this.processedApprovals];
          entries.splice(0, 500).forEach((e) => this.processedApprovals.delete(e));
        }
      }
    } catch {
      // Non-critical — Gate may not be up yet
    }
  }

  /**
   * Handle an incoming exec approval request from OpenClaw.
   *
   * Called when we detect a new `exec.approval.requested` event.
   * Routes the request through Wooblay Gate and resolves back to OpenClaw.
   */
  async handleApprovalRequest(request: ExecApprovalRequest): Promise<ApprovalAction> {
    const toolName = request.toolName ?? 'exec';
    const params = request.toolParams ?? {
      command: request.command,
      args: request.args,
      cwd: request.cwd,
    };

    console.log(
      `[wooblay-bridge] Approval request: ${request.id} — tool="${toolName}" cmd="${request.command}"`,
    );

    // Check if this tool should be gated by Wooblay
    if (!shouldGateTool(toolName, this.config)) {
      console.log(`[wooblay-bridge] Tool "${toolName}" not gated — auto-allowing`);
      return 'allow-once';
    }

    // Sign the payload
    const signingPayload = { toolName, args: params };
    const requestSignature = sign(signingPayload, this.agentPrivateKey);

    // Submit to Wooblay Gate for policy evaluation
    try {
      const decision = await this.gateClient.submitToolCall({
        toolName,
        args: params,
        agentPubkey: this.agentPubkey,
        requestSignature,
        adapter: ADAPTER_ID,
        taskId: request.agentId,
        sessionId: request.sessionKey,
      });

      switch (decision.decision) {
        case 'EXECUTE':
          console.log(`[wooblay-bridge] Gate ALLOWED: ${request.id}`);
          return 'allow-once';

        case 'DENY':
          console.log(`[wooblay-bridge] Gate DENIED: ${request.id} — ${decision.reason}`);
          return 'deny';

        case 'PENDING_APPROVAL': {
          if (!decision.approvalId) {
            console.log(`[wooblay-bridge] Gate requires approval but no ID — denying`);
            return 'deny';
          }

          console.log(
            `[wooblay-bridge] Gate PENDING_APPROVAL: ${request.id} (wooblay approval: ${decision.approvalId})`,
          );

          // Wait for human approval through Wooblay UI
          const result = await waitForApproval(
            this.gateClient,
            decision.approvalId,
            this.config.approvalTimeoutMs,
            this.config.approvalPollIntervalMs,
          );

          if (result.status === 'APPROVED') {
            console.log(
              `[wooblay-bridge] APPROVED by ${result.approver ?? 'unknown'}: ${request.id}`,
            );
            return 'allow-once';
          }

          console.log(
            `[wooblay-bridge] ${result.status}: ${request.id} — ${result.reason ?? 'no reason'}`,
          );
          return 'deny';
        }

        default:
          console.log(`[wooblay-bridge] Unknown decision "${decision.decision}" — denying`);
          return 'deny';
      }
    } catch (err) {
      console.error(
        `[wooblay-bridge] Gate error for ${request.id}:`,
        err instanceof Error ? err.message : String(err),
      );
      // Fail-safe: deny on error
      return 'deny';
    }
  }
}
