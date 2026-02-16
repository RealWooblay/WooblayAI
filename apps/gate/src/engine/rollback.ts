/**
 * Rollback Engine — explicit rollback semantics.
 *
 * Rollback is an action class, not a magic undo. Each rollback:
 * - Creates a new Proposal with actionClass "rollback:*"
 * - Links back to the original proposal via `rollbackOf`
 * - Requires approval (risk class >= original)
 * - Executes via the same gateway (capability token required)
 *
 * MVP rollback types:
 * - rollback:pr_revert  → Create a revert PR
 * - rollback:capability_revoke → Revoke capabilities + quarantine run
 * - rollback:config_revert → Revert config file changes
 */

import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { emitRunEvent } from './run-events.js';

// ── Types ───────────────────────────────────────────────────────────────

export type RollbackType = 'rollback:pr_revert' | 'rollback:capability_revoke' | 'rollback:config_revert';

export interface RollbackInput {
  originalProposalId: string;
  runId: string;
  type: RollbackType;
  reason: string;
  compensatingParams?: Record<string, unknown>;
}

export interface RollbackResult {
  rollbackProposalId: string;
  status: 'pending' | 'auto_executed';
}

// ── Rollback Proposal Creation ──────────────────────────────────────────

export async function createRollbackProposal(
  prisma: PrismaClient,
  input: RollbackInput,
): Promise<RollbackResult> {
  const original = await prisma.proposal.findUnique({
    where: { id: input.originalProposalId },
  });

  if (!original) {
    throw new Error(`Original proposal not found: ${input.originalProposalId}`);
  }

  // Rollback risk is at least as high as the original
  const riskClass = original.riskClass;

  const argsHash = createHash('sha256')
    .update(JSON.stringify({
      originalProposalId: input.originalProposalId,
      type: input.type,
      params: input.compensatingParams,
    }))
    .digest('hex');

  const proposal = await prisma.proposal.create({
    data: {
      runId: input.runId,
      actionClass: input.type,
      toolName: `rollback_${input.type.split(':')[1]}`,
      argsHash,
      riskClass,
      irreversible: false, // Rollbacks are by nature reversible
      compensatingAction: `Re-apply original action: ${original.actionClass}`,
      status: 'pending',
      rollbackOf: input.originalProposalId,
    },
  });

  // For capability revocation, auto-execute (no approval needed)
  if (input.type === 'rollback:capability_revoke') {
    await prisma.capability.updateMany({
      where: { runId: input.runId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await prisma.proposal.update({
      where: { id: proposal.id },
      data: { status: 'executed' },
    });

    await emitRunEvent(prisma, input.runId, 'rollback', {
      rollbackProposalId: proposal.id,
      originalProposalId: input.originalProposalId,
      type: input.type,
      reason: input.reason,
      autoExecuted: true,
    });

    return { rollbackProposalId: proposal.id, status: 'auto_executed' };
  }

  // For PR reverts and config reverts, require approval
  await emitRunEvent(prisma, input.runId, 'rollback', {
    rollbackProposalId: proposal.id,
    originalProposalId: input.originalProposalId,
    type: input.type,
    reason: input.reason,
    autoExecuted: false,
  });

  return { rollbackProposalId: proposal.id, status: 'pending' };
}

/**
 * Get all rollback proposals for a run.
 */
export async function getRollbacksForRun(
  prisma: PrismaClient,
  runId: string,
): Promise<{ id: string; type: string; status: string; originalProposalId: string | null }[]> {
  const proposals = await prisma.proposal.findMany({
    where: {
      runId,
      actionClass: { startsWith: 'rollback:' },
    },
    orderBy: { createdAt: 'desc' },
  });

  return proposals.map((p) => ({
    id: p.id,
    type: p.actionClass,
    status: p.status,
    originalProposalId: p.rollbackOf,
  }));
}
