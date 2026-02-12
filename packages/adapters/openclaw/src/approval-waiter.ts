/**
 * Approval waiter: polls Gate for approval resolution.
 *
 * When Gate returns PENDING_APPROVAL, the before_tool_call hook must block
 * until the approval is resolved (approved, denied, or expired).
 * This module handles the polling loop with timeout.
 */

import type { PluginGateClient, ApprovalStatus } from './gate-client.js';

export interface ApprovalWaitResult {
  status: 'APPROVED' | 'DENIED' | 'EXPIRED' | 'TIMEOUT';
  approver?: string;
  reason?: string;
}

/**
 * Wait for an approval to be resolved by polling Gate.
 *
 * @param client       - Gate client instance
 * @param approvalId   - The approval ID returned by Gate
 * @param timeoutMs    - Maximum time to wait (default: 5 minutes)
 * @param pollMs       - Polling interval (default: 2 seconds)
 * @returns            - The final approval status
 */
export async function waitForApproval(
  client: PluginGateClient,
  approvalId: string,
  timeoutMs: number = 300_000,
  pollMs: number = 2_000,
): Promise<ApprovalWaitResult> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const status: ApprovalStatus = await client.getApprovalStatus(approvalId);

      if (status.status === 'APPROVED') {
        return { status: 'APPROVED', approver: status.approver, reason: status.reason };
      }
      if (status.status === 'DENIED') {
        return { status: 'DENIED', approver: status.approver, reason: status.reason };
      }
      if (status.status === 'EXPIRED') {
        return { status: 'EXPIRED', reason: 'Approval TTL expired' };
      }

      // Still PENDING — wait and poll again
    } catch (err) {
      // Transient network error — log and retry
      console.error(
        `[wooblay] Error polling approval ${approvalId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }

    await sleep(pollMs);
  }

  // Deadline exceeded
  return { status: 'TIMEOUT', reason: `Approval timed out after ${timeoutMs}ms` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
