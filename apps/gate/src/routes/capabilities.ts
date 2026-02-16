/**
 * Capability token routes.
 *
 * Issue, validate, revoke, and query capability tokens.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import {
  mintCapability,
  validateCapability,
  revokeCapability,
  revokeAllForRun,
  getActiveCapabilities,
} from '../engine/capability.js';

export async function capabilityRoutes(app: FastifyInstance): Promise<void> {
  // ── Mint a new capability token ───────────────────────────────────────
  app.post('/api/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      runId: string;
      actionClass: string;
      scope?: Record<string, unknown>;
      ttlMs?: number;
      maxUses?: number;
      workspaceId?: string;
    };

    if (!body.runId || !body.actionClass) {
      return reply.code(400).send({ error: 'runId and actionClass are required' });
    }

    try {
      const capability = await mintCapability(prisma, {
        runId: body.runId,
        actionClass: body.actionClass,
        scope: body.scope ?? {},
        ttlMs: body.ttlMs,
        maxUses: body.maxUses,
        workspaceId: body.workspaceId,
      });

      return reply.code(201).send({
        token: capability.id,
        runId: capability.runId,
        actionClass: capability.actionClass,
        expiresAt: capability.expiresAt,
        maxUses: capability.maxUses,
      });
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Validate a capability token ───────────────────────────────────────
  app.post('/api/capabilities/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { token: string; actionClass: string };

    if (!body.token || !body.actionClass) {
      return reply.code(400).send({ error: 'token and actionClass are required' });
    }

    const result = await validateCapability(prisma, body.token, body.actionClass);
    return reply.send(result);
  });

  // ── Revoke a capability token ─────────────────────────────────────────
  app.post('/api/capabilities/:id/revoke', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };

    try {
      const capability = await revokeCapability(prisma, id, body?.reason ?? 'Manual revocation');
      return reply.send(capability);
    } catch (err: any) {
      return reply.code(404).send({ error: 'Capability not found' });
    }
  });

  // ── Revoke all capabilities for a run ─────────────────────────────────
  app.post('/api/runs/:runId/capabilities/revoke-all', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as { reason?: string };

    const count = await revokeAllForRun(prisma, runId, body?.reason ?? 'Bulk revocation');
    return reply.send({ revoked: count });
  });

  // ── List active capabilities for a run ────────────────────────────────
  app.get('/api/runs/:runId/capabilities', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };
    const capabilities = await getActiveCapabilities(prisma, runId);
    return reply.send(capabilities);
  });
}
