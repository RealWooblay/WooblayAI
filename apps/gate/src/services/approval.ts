/**
 * Approval service.
 *
 * Manages the lifecycle of human-in-the-loop approvals for tool calls that
 * require sign-off before execution.
 */

import type { PrismaClient } from '@prisma/client';
import type { ApprovalStatus, RiskTier } from '@wooblay/types';
import { persistEvent } from '../events/bus.js';

/** Default approval window: 24 hours (enterprise SLA). */
const DEFAULT_APPROVAL_TTL_SECONDS = 86_400; // 24 hours

/**
 * Create a PENDING approval for a tool call and emit an event.
 */
export async function createApproval(
  prisma: PrismaClient,
  toolCallId: string,
  ttlSeconds: number = DEFAULT_APPROVAL_TTL_SECONDS,
): Promise<{ id: string }> {
  // Fetch the tool call to include metadata in the event
  const toolCall = await prisma.toolCall.findUniqueOrThrow({
    where: { id: toolCallId },
  });

  const approval = await prisma.approval.create({
    data: {
      toolCallId,
      status: 'PENDING',
      ttlSeconds,
    },
  });

  await persistEvent(prisma, {
    type: 'approval.created',
    data: {
      approvalId: approval.id,
      toolCallId,
      toolName: toolCall.toolName,
      riskTier: toolCall.riskTier as RiskTier,
    },
  });

  return { id: approval.id };
}

/**
 * Resolve an existing approval (APPROVED or DENIED) and emit an event.
 */
export async function resolveApproval(
  prisma: PrismaClient,
  id: string,
  status: ApprovalStatus,
  approver: string,
  reason?: string,
): Promise<void> {
  await prisma.approval.update({
    where: { id },
    data: {
      status,
      approver,
      reason: reason ?? null,
      decidedAt: new Date(),
    },
  });

  await persistEvent(prisma, {
    type: 'approval.resolved',
    data: {
      approvalId: id,
      status,
      approver,
    },
  });
}
