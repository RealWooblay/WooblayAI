/**
 * Rollback routes — explicit rollback action endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { createRollbackProposal, getRollbacksForRun, type RollbackType } from '../engine/rollback.js';

export async function rollbackRoutes(app: FastifyInstance): Promise<void> {
  // ── Create a rollback proposal ────────────────────────────────────────
  app.post('/api/runs/:runId/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      originalProposalId: string;
      type: RollbackType;
      reason: string;
      compensatingParams?: Record<string, unknown>;
    };

    if (!body.originalProposalId || !body.type || !body.reason) {
      return reply.code(400).send({ error: 'originalProposalId, type, and reason are required' });
    }

    const validTypes: RollbackType[] = ['rollback:pr_revert', 'rollback:capability_revoke', 'rollback:config_revert'];
    if (!validTypes.includes(body.type)) {
      return reply.code(400).send({ error: `Invalid rollback type. Must be one of: ${validTypes.join(', ')}` });
    }

    try {
      const result = await createRollbackProposal(prisma, {
        originalProposalId: body.originalProposalId,
        runId,
        type: body.type,
        reason: body.reason,
        compensatingParams: body.compensatingParams,
      });
      return reply.send(result);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── List rollback proposals for a run ─────────────────────────────────
  app.get('/api/runs/:runId/rollbacks', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };
    const rollbacks = await getRollbacksForRun(prisma, runId);
    return reply.send(rollbacks);
  });
}
