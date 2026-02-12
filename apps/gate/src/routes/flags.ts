/**
 * Flag routes.
 *
 * View, filter, and dismiss AI-detected audit flags.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

export async function flagRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/flags — List flags with pagination and filters.
   *
   * Query: ?severity=CRITICAL&dismissed=false&limit=50&offset=0
   */
  app.get('/api/flags', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      severity?: string;
      category?: string;
      dismissed?: string;
      limit?: string;
      offset?: string;
    };

    const where: Record<string, unknown> = {};
    if (query.severity) where.severity = query.severity;
    if (query.category) where.category = query.category;
    if (query.dismissed !== undefined) where.dismissed = query.dismissed === 'true';

    try {
      const [flags, total] = await Promise.all([
        prisma.auditFlag.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: Math.min(parseInt(query.limit ?? '50'), 200),
          skip: parseInt(query.offset ?? '0'),
        }),
        prisma.auditFlag.count({ where }),
      ]);

      // Summary counts by severity
      const summary = await prisma.auditFlag.groupBy({
        by: ['severity'],
        where: { dismissed: false },
        _count: { severity: true },
      });
      const bySeverity: Record<string, number> = {};
      for (const row of summary) {
        bySeverity[row.severity] = row._count.severity;
      }

      return reply.send({
        flags,
        total,
        summary: bySeverity,
      });
    } catch (err) {
      request.log.error(err, 'Failed to list flags');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/flags/:id/dismiss — Dismiss a flag.
   */
  app.post('/api/flags/:id/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const flag = await prisma.auditFlag.update({
        where: { id },
        data: { dismissed: true },
      });
      return reply.send(flag);
    } catch (err) {
      request.log.error(err, 'Failed to dismiss flag');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
