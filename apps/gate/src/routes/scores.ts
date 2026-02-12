/**
 * Score routes.
 *
 * Allows agents / operators to submit quality scores for completed tasks and
 * query them by task ID.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CreateScoreRequestSchema } from '@wooblay/schemas';
import { prisma } from '../db/client.js';
import { validateBody } from '../middleware/validate.js';
import { persistEvent } from '../events/bus.js';

export async function scoreRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/scores — Submit a score for a task.
   */
  app.post(
    '/api/scores',
    { preHandler: validateBody(CreateScoreRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        taskId: string;
        agentPubkey: string;
        label: string;
        cost?: number;
        duration?: number;
        notes?: string;
      };

      try {
        const score = await prisma.score.create({
          data: {
            taskId: body.taskId,
            agentPubkey: body.agentPubkey,
            label: body.label,
            cost: body.cost ?? null,
            duration: body.duration ?? null,
            notes: body.notes ?? null,
          },
        });

        // Emit score.created event → triggers task-level analysis
        await persistEvent(prisma, {
          type: 'score.created',
          data: {
            scoreId: score.id,
            taskId: body.taskId,
            agentPubkey: body.agentPubkey,
          },
        });

        return reply.code(201).send(score);
      } catch (err) {
        request.log.error(err, 'Failed to create score');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/scores?taskId=X — List scores for a specific task.
   */
  app.get('/api/scores', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { taskId?: string };

    try {
      const where = query.taskId ? { taskId: query.taskId } : {};

      const scores = await prisma.score.findMany({
        where,
        orderBy: { createdAt: 'desc' },
      });

      return reply.send(scores);
    } catch (err) {
      request.log.error(err, 'Failed to list scores');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
