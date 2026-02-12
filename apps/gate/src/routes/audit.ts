/**
 * Audit routes.
 *
 * Provides the audit log (enriched tool call history) and audit flag
 * management endpoints.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { describeToolCall, describeRisk } from '../engine/analysis.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/audit/log — Chronological feed of all tool calls with decisions,
   * enriched with human-readable descriptions.
   */
  app.get('/api/audit/log', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      agent?: string;
      riskTier?: string;
      decision?: string;
      since?: string;
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '50', 10)));
    const skip = (page - 1) * pageSize;

    try {
      // Build where clause
      const where: Record<string, unknown> = {};

      if (query.agent) {
        where['agentPubkey'] = query.agent;
      }
      if (query.riskTier) {
        where['riskTier'] = query.riskTier;
      }
      if (query.since) {
        where['createdAt'] = { gte: new Date(query.since) };
      }

      // If filtering by decision, we need to filter via receipt relation
      if (query.decision) {
        where['receipt'] = { policyDecision: query.decision };
      }

      const [toolCalls, total] = await Promise.all([
        prisma.toolCall.findMany({
          where,
          include: {
            approval: true,
            receipt: true,
            agent: { select: { name: true, pubkey: true } },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        prisma.toolCall.count({ where }),
      ]);

      const entries = toolCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.args);
        } catch {
          // keep empty
        }

        return {
          toolCall: tc,
          approval: tc.approval ?? null,
          receipt: tc.receipt ?? null,
          agentName: tc.agent.name,
          humanDescription: describeToolCall(tc.toolName, parsedArgs),
          riskExplanation: describeRisk(tc.riskTier, tc.toolName, parsedArgs),
        };
      });

      return reply.send({
        data: entries,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (err) {
      request.log.error(err, 'Failed to fetch audit log');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/audit/flags — List all audit flags, ordered by severity then createdAt.
   */
  app.get('/api/audit/flags', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      severity?: string;
      category?: string;
      dismissed?: string;
      page?: string;
      pageSize?: string;
    };

    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '50', 10)));
    const skip = (page - 1) * pageSize;

    try {
      const where: Record<string, unknown> = {};

      if (query.severity) {
        where['severity'] = query.severity;
      }
      if (query.category) {
        where['category'] = query.category;
      }
      if (query.dismissed !== undefined) {
        where['dismissed'] = query.dismissed === 'true';
      }

      // Custom severity ordering: CRITICAL > HIGH > MEDIUM > LOW > INFO
      const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

      const [flagsRaw, total] = await Promise.all([
        prisma.auditFlag.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }],
          skip,
          take: pageSize,
        }),
        prisma.auditFlag.count({ where }),
      ]);

      // Sort by severity order, then by createdAt desc (already from DB)
      const flags = flagsRaw.sort((a, b) => {
        const aIdx = severityOrder.indexOf(a.severity);
        const bIdx = severityOrder.indexOf(b.severity);
        if (aIdx !== bIdx) return aIdx - bIdx;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });

      return reply.send({
        data: flags,
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.ceil(total / pageSize),
        },
      });
    } catch (err) {
      request.log.error(err, 'Failed to fetch audit flags');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/audit/flags/:id/dismiss — Dismiss a flag.
   */
  app.post('/api/audit/flags/:id/dismiss', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const flag = await prisma.auditFlag.findUnique({ where: { id } });

      if (!flag) {
        return reply.code(404).send({ error: 'Flag not found' });
      }

      const updated = await prisma.auditFlag.update({
        where: { id },
        data: { dismissed: true },
      });

      return reply.send(updated);
    } catch (err) {
      request.log.error(err, 'Failed to dismiss flag');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/audit/analyze — Deprecated. Use POST /api/analysis/recompute instead.
   * Kept for backward compat; proxies to the new analysis pipeline.
   */
  app.post('/api/audit/analyze', async (request: FastifyRequest, reply: FastifyReply) => {
    return reply.code(301).send({
      message: 'Deprecated. Use POST /api/analysis/recompute?taskId=... instead.',
    });
  });
}
