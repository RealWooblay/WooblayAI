/**
 * Verification routes — post-action proof endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

export async function verificationRoutes(app: FastifyInstance): Promise<void> {
  // ── List verifications for a run ──────────────────────────────────────
  app.get('/api/runs/:runId/verifications', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };

    const verifications = await prisma.verification.findMany({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send(verifications.map((v) => ({
      ...v,
      expectedOutcome: JSON.parse(v.expectedOutcome),
      observedOutcome: v.observedOutcome ? JSON.parse(v.observedOutcome) : null,
      apiReads: v.apiReads ? JSON.parse(v.apiReads) : [],
    })));
  });

  // ── Get a specific verification ───────────────────────────────────────
  app.get('/api/verifications/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const verification = await prisma.verification.findUnique({ where: { id } });
    if (!verification) return reply.code(404).send({ error: 'Verification not found' });

    return reply.send({
      ...verification,
      expectedOutcome: JSON.parse(verification.expectedOutcome),
      observedOutcome: verification.observedOutcome ? JSON.parse(verification.observedOutcome) : null,
      apiReads: verification.apiReads ? JSON.parse(verification.apiReads) : [],
    });
  });

  // ── Verification stats for a run ──────────────────────────────────────
  app.get('/api/runs/:runId/verification-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };

    const [total, passed, failed, skipped] = await Promise.all([
      prisma.verification.count({ where: { runId } }),
      prisma.verification.count({ where: { runId, status: 'passed' } }),
      prisma.verification.count({ where: { runId, status: 'failed' } }),
      prisma.verification.count({ where: { runId, status: 'skipped' } }),
    ]);

    return reply.send({
      total,
      passed,
      failed,
      skipped,
      passRate: total > 0 ? passed / total : null,
    });
  });
}
