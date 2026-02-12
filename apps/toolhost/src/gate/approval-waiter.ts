import { type Approval, ApprovalStatus } from '@wooblay/types';
import type { GateClient } from '@wooblay/gate-client';

const POLL_INTERVAL_MS = 2_000;

/** Resolved statuses that indicate the approval is no longer pending. */
const RESOLVED_STATUSES = new Set<string>([
  ApprovalStatus.APPROVED,
  ApprovalStatus.DENIED,
  ApprovalStatus.EXPIRED,
]);

/**
 * Poll the Gate API until an approval has been resolved (approved, denied, or expired).
 *
 * @param gateClient - Configured GateClient instance
 * @param approvalId - The approval ID to poll
 * @param timeoutMs  - Maximum time to wait before throwing (default: 5 minutes)
 * @returns The resolved Approval object
 * @throws If the timeout is exceeded before a decision is made
 */
export async function waitForApproval(
  gateClient: GateClient,
  approvalId: string,
  timeoutMs: number = 300_000,
): Promise<Approval> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const approval = await gateClient.getApproval(approvalId);

      if (RESOLVED_STATUSES.has(approval.status as ApprovalStatus)) {
        return approval;
      }
    } catch (err) {
      // Log but keep polling – transient network errors shouldn't abort the wait
      console.error(
        `[approval-waiter] Error polling approval ${approvalId}:`,
        err instanceof Error ? err.message : err,
      );
    }

    // Wait before the next poll
    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(
    `Approval ${approvalId} was not resolved within ${timeoutMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
