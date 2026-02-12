/**
 * Agent CRUD routes.
 *
 * Full create / read / update / delete for the Agent registry.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
} from '@wooblay/schemas';
import { prisma } from '../db/client.js';
import { validateBody } from '../middleware/validate.js';

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/agents — List all registered agents.
   */
  app.get('/api/agents', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const agents = await prisma.agent.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(agents);
    } catch (err) {
      _request.log.error(err, 'Failed to list agents');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/agents — Register a new agent.
   */
  app.post(
    '/api/agents',
    { preHandler: validateBody(CreateAgentRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        pubkey: string;
        name: string;
        allowlisted: boolean;
      };

      try {
        const agent = await prisma.agent.create({
          data: {
            pubkey: body.pubkey,
            name: body.name,
            allowlisted: body.allowlisted,
          },
        });

        return reply.code(201).send(agent);
      } catch (err) {
        request.log.error(err, 'Failed to create agent');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * PATCH /api/agents/:id — Update an existing agent.
   */
  app.patch(
    '/api/agents/:id',
    { preHandler: validateBody(UpdateAgentRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      try {
        const existing = await prisma.agent.findUnique({ where: { id } });
        if (!existing) {
          return reply.code(404).send({ error: 'Agent not found' });
        }

        const agent = await prisma.agent.update({
          where: { id },
          data: body,
        });

        return reply.send(agent);
      } catch (err) {
        request.log.error(err, 'Failed to update agent');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /api/agents/:id — Delete an agent.
   */
  app.delete('/api/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const existing = await prisma.agent.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      await prisma.agent.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete agent');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
