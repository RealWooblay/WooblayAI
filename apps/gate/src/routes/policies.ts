/**
 * Policy management routes.
 *
 * CRUD for policy rules + preset application.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { ALL_PRESETS } from '../db/seed-policies.js';

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/policies — List all policy rules ordered by priority.
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
   *
   * Body: { matchTool, riskTier, decision, matchArgs?, constraints?, enabled? }
   * Priority is auto-assigned (max + 10).
   */
  app.post('/api/policies', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      matchTool: string;
      riskTier: string;
      decision: string;
      matchArgs?: string;
      constraints?: string;
      enabled?: boolean;
    };

    if (!body.matchTool || !body.riskTier || !body.decision) {
      return reply.code(400).send({ error: 'matchTool, riskTier, and decision are required' });
    }

    const validDecisions = ['ALLOW', 'DENY', 'APPROVE'];
    if (!validDecisions.includes(body.decision)) {
      return reply.code(400).send({ error: `decision must be one of: ${validDecisions.join(', ')}` });
    }

    try {
      // Auto-assign priority: max existing + 10
      const maxRule = await prisma.policyRule.findFirst({
        orderBy: { priority: 'desc' },
        select: { priority: true },
      });
      const priority = (maxRule?.priority ?? 0) + 10;

      const rule = await prisma.policyRule.create({
        data: {
          priority,
          matchTool: body.matchTool,
          riskTier: body.riskTier,
          decision: body.decision,
          matchArgs: body.matchArgs ?? null,
          constraints: body.constraints ?? null,
          enabled: body.enabled ?? true,
        },
      });

      return reply.code(201).send(rule);
    } catch (err) {
      request.log.error(err, 'Failed to create policy rule');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/policies/:id — Update a policy rule.
   */
  app.patch('/api/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      matchTool?: string;
      riskTier?: string;
      decision?: string;
      matchArgs?: string | null;
      constraints?: string | null;
      enabled?: boolean;
    };

    if (body.decision) {
      const validDecisions = ['ALLOW', 'DENY', 'APPROVE'];
      if (!validDecisions.includes(body.decision)) {
        return reply.code(400).send({ error: `decision must be one of: ${validDecisions.join(', ')}` });
      }
    }

    try {
      const rule = await prisma.policyRule.update({
        where: { id },
        data: {
          ...(body.matchTool !== undefined && { matchTool: body.matchTool }),
          ...(body.riskTier !== undefined && { riskTier: body.riskTier }),
          ...(body.decision !== undefined && { decision: body.decision }),
          ...(body.matchArgs !== undefined && { matchArgs: body.matchArgs }),
          ...(body.constraints !== undefined && { constraints: body.constraints }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      });

      return reply.send(rule);
    } catch (err) {
      request.log.error(err, 'Failed to update policy rule');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/policies/:id — Delete a policy rule.
   */
  app.delete('/api/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.policyRule.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete policy rule');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/policies/presets/:name — Replace all rules with a preset.
   *
   * Deletes all existing rules and creates the preset's rules.
   */
  app.post('/api/policies/presets/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const preset = ALL_PRESETS[name];

    if (!preset) {
      const available = Object.keys(ALL_PRESETS).join(', ');
      return reply.code(400).send({ error: `Unknown preset "${name}". Available: ${available}` });
    }

    try {
      await prisma.$transaction([
        prisma.policyRule.deleteMany(),
        ...preset.rules.map((rule) =>
          prisma.policyRule.create({ data: rule }),
        ),
      ]);

      const rules = await prisma.policyRule.findMany({
        orderBy: { priority: 'asc' },
      });

      return reply.send({
        preset: preset.name,
        description: preset.description,
        rules,
      });
    } catch (err) {
      request.log.error(err, 'Failed to apply preset');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/policies/presets — List available presets.
   */
  app.get('/api/policies/presets', async (_request: FastifyRequest, reply: FastifyReply) => {
    const presets = Object.entries(ALL_PRESETS).map(([key, preset]) => ({
      id: key,
      name: preset.name,
      description: preset.description,
      ruleCount: preset.rules.length,
    }));
    return reply.send(presets);
  });
}
