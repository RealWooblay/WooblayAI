import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';
import { checkForAnomalies, processAndNotifyAnomalies } from '../engine/anomaly-detection.js';

export async function anomalyRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/api/anomalies',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = await resolveOrgIdForRequest(prisma, request);
      if (!orgId) return reply.code(401).send({ error: 'Unauthorized' });

      const alerts = await checkForAnomalies(prisma, orgId);
      return reply.send({ alerts, count: alerts.length });
    },
  );

  app.post(
    '/api/anomalies/check',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = await resolveOrgIdForRequest(prisma, request);
      if (!orgId) return reply.code(401).send({ error: 'Unauthorized' });

      const alerts = await processAndNotifyAnomalies(prisma, orgId);
      return reply.send({ alerts, count: alerts.length, notified: true });
    },
  );
}
