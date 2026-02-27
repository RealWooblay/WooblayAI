import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';
import { computeOrgContributions, type ContributionFilters } from '../engine/contributions.js';

export async function contributionRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/org/contributions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = await resolveOrgIdForRequest(prisma, request);
      if (!orgId) return reply.code(401).send({ error: 'Unauthorized' });

      const query = request.query as { period?: string; groupBy?: string };
      const period = (['day', 'week', 'month'].includes(query.period ?? '')
        ? query.period
        : 'week') as ContributionFilters['period'];
      const groupBy = (['agent', 'user', 'tool'].includes(query.groupBy ?? '')
        ? query.groupBy
        : 'agent') as ContributionFilters['groupBy'];

      const result = await computeOrgContributions(prisma, orgId, { period, groupBy });
      return reply.send(result);
    },
  );
}
