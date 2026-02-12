/**
 * Policy CRUD routes.
 *
 * Full create / read / update / delete for the PolicyRule table. Rules are
 * always returned ordered by priority (lowest number first).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  CreatePolicyRequestSchema,
  UpdatePolicyRequestSchema,
} from '@wooblay/schemas';
import { prisma } from '../db/client.js';
import { persistEvent } from '../events/bus.js';
import { validateBody } from '../middleware/validate.js';
import { ALL_PRESETS } from '../db/seed-policies.js';

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/policies — List all policy rules, ordered by priority.
   */
  app.get('/api/policies', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rules = await prisma.policyRule.findMany({
        orderBy: { priority: 'asc' },
      });
      return reply.send(rules);
    } catch (err) {
      _request.log.error(err, 'Failed to list policies');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/policies — Create a new policy rule.
   */
  app.post(
    '/api/policies',
    { preHandler: validateBody(CreatePolicyRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        priority: number;
        matchTool: string;
        matchArgs?: string;
        riskTier: string;
        decision: string;
        constraints?: string;
        enabled: boolean;
      };

      try {
        const rule = await prisma.policyRule.create({
          data: {
            priority: body.priority,
            matchTool: body.matchTool,
            matchArgs: body.matchArgs ?? null,
            riskTier: body.riskTier,
            decision: body.decision,
            constraints: body.constraints ?? null,
            enabled: body.enabled,
          },
        });

        await persistEvent(prisma, {
          type: 'policy.updated',
          data: { policyId: rule.id },
        });

        return reply.code(201).send(rule);
      } catch (err) {
        request.log.error(err, 'Failed to create policy');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * PATCH /api/policies/:id — Update an existing policy rule.
   */
  app.patch(
    '/api/policies/:id',
    { preHandler: validateBody(UpdatePolicyRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;

      try {
        const existing = await prisma.policyRule.findUnique({ where: { id } });
        if (!existing) {
          return reply.code(404).send({ error: 'Policy rule not found' });
        }

        const rule = await prisma.policyRule.update({
          where: { id },
          data: body,
        });

        await persistEvent(prisma, {
          type: 'policy.updated',
          data: { policyId: rule.id },
        });

        return reply.send(rule);
      } catch (err) {
        request.log.error(err, 'Failed to update policy');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /api/policies/:id — Delete a policy rule.
   */
  app.delete('/api/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const existing = await prisma.policyRule.findUnique({ where: { id } });
      if (!existing) {
        return reply.code(404).send({ error: 'Policy rule not found' });
      }

      await prisma.policyRule.delete({ where: { id } });

      await persistEvent(prisma, {
        type: 'policy.updated',
        data: { policyId: id },
      });

      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete policy');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/policies/presets — List available policy presets.
   */
  app.get('/api/policies/presets', async (_request: FastifyRequest, reply: FastifyReply) => {
    const presets = Object.entries(ALL_PRESETS).map(([key, preset]) => ({
      key,
      name: preset.name,
      description: preset.description,
      ruleCount: preset.rules.length,
    }));
    return reply.send(presets);
  });

  /**
   * POST /api/policies/presets/:key/apply — Replace all policies with a preset.
   */
  app.post('/api/policies/presets/:key/apply', async (request: FastifyRequest, reply: FastifyReply) => {
    const { key } = request.params as { key: string };
    const preset = ALL_PRESETS[key];

    if (!preset) {
      return reply.code(404).send({ error: `Unknown preset: ${key}` });
    }

    try {
      // Delete all existing policies and create the preset rules in a transaction
      await prisma.$transaction([
        prisma.policyRule.deleteMany(),
        ...preset.rules.map((rule) =>
          prisma.policyRule.create({ data: rule }),
        ),
      ]);

      await persistEvent(prisma, {
        type: 'policy.updated',
        data: { policyId: `preset:${key}` },
      });

      const rules = await prisma.policyRule.findMany({
        orderBy: { priority: 'asc' },
      });

      return reply.send({ applied: key, rules });
    } catch (err) {
      request.log.error(err, 'Failed to apply preset');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
