/**
 * Kill Switch routes — instantly pause/resume all agent activity for an org
 * by toggling the `active` flag on all API keys.
 *
 *   POST /api/kill-switch  — toggle all keys active/inactive
 *   GET  /api/kill-switch  — get current kill switch status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';
import { persistEvent } from '../events/bus.js';

export async function killSwitchRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/kill-switch — Toggle all API keys active/inactive.
   * Body: { active: boolean }
   * Returns: { paused: boolean, keysAffected: number }
   */
  app.post('/api/kill-switch', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required' });
    }

    const body = request.body as { active?: boolean };
    if (typeof body.active !== 'boolean') {
      return reply.code(400).send({ error: '`active` (boolean) is required' });
    }

    const result = await prisma.apiKey.updateMany({
      where: { orgId, revokedAt: null },
      data: { active: body.active },
    });

    await persistEvent(prisma, {
      type: (body.active ? 'kill_switch.resumed' : 'kill_switch.engaged') as any,
      data: { orgId, keysAffected: result.count, active: body.active } as any,
    });

    request.log.info({ orgId, active: body.active, keysAffected: result.count }, 'Kill switch toggled');

    return reply.send({
      paused: !body.active,
      keysAffected: result.count,
    });
  });

  /**
   * GET /api/kill-switch — Get current kill switch status.
   * Returns: { paused: boolean, activeKeys: number, totalKeys: number }
   */
  app.get('/api/kill-switch', async (request: FastifyRequest, reply: FastifyReply) => {
    const orgId = await resolveOrgIdForRequest(prisma, request);
    if (!orgId) {
      return reply.code(403).send({ error: 'Organization required' });
    }

    const [activeKeys, totalKeys] = await Promise.all([
      prisma.apiKey.count({ where: { orgId, revokedAt: null, active: true } }),
      prisma.apiKey.count({ where: { orgId, revokedAt: null } }),
    ]);

    return reply.send({
      paused: totalKeys > 0 && activeKeys === 0,
      activeKeys,
      totalKeys,
    });
  });
}
