/**
 * Approval service.
 *
 * Manages the lifecycle of human-in-the-loop approvals for tool calls that
 * require sign-off before execution.
 */

import type { PrismaClient } from '@prisma/client';
import type { ApprovalStatus, RiskTier } from '@wooblay/types';
import { persistEvent } from '../events/bus.js';
import { sendApprovalNotification } from './notifications.js';

/** Default approval window: 24 hours (enterprise SLA). */
const DEFAULT_APPROVAL_TTL_SECONDS = 86_400; // 24 hours

/**
 * Create a PENDING approval for a tool call and emit an event.
 */
export async function createApproval(
  prisma: PrismaClient,
  toolCallId: string,
  ttlSeconds: number = DEFAULT_APPROVAL_TTL_SECONDS,
  requiredApproverRole?: string | null,
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
      requiredApproverRole: requiredApproverRole ?? null,
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

  // Send notification to eligible approvers (best-effort, don't block)
  // Resolve orgId through the API key (agentPubkey = "apikey:<id>") or fall back to any org
  let notifyOrgId: string | null = null;
  if (toolCall.agentPubkey.startsWith('apikey:')) {
    const keyId = toolCall.agentPubkey.replace('apikey:', '');
    const key = await prisma.apiKey.findUnique({ where: { id: keyId }, select: { orgId: true } }).catch(() => null);
    notifyOrgId = key?.orgId ?? null;
  }
  if (!notifyOrgId) {
    const org = await prisma.organization.findFirst({ select: { id: true } }).catch(() => null);
    notifyOrgId = org?.id ?? null;
  }

  if (notifyOrgId) {
    sendApprovalNotification(
      prisma,
      notifyOrgId,
      approval.id,
      toolCall.toolName,
      toolCall.riskTier,
      toolCall.args,
      requiredApproverRole,
    ).catch((err) => console.error('[notifications] Failed to send approval notification:', err));
  }

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

/**
 * Atomically resolve an approval only if it is still PENDING.
 * Returns true if the update succeeded, false if already resolved.
 * Prevents race conditions when multiple channels try to resolve simultaneously.
 */
export async function resolveApprovalAtomic(
  prisma: PrismaClient,
  id: string,
  status: ApprovalStatus,
  approver: string,
  reason?: string,
): Promise<boolean> {
  const result = await prisma.approval.updateMany({
    where: { id, status: 'PENDING' },
    data: {
      status,
      approver,
      reason: reason ?? null,
      decidedAt: new Date(),
    },
  });

  if (result.count === 0) return false;

  await persistEvent(prisma, {
    type: 'approval.resolved',
    data: {
      approvalId: id,
      status,
      approver,
    },
  });

  return true;
}
