/**
 * Activity feed routes.
 *
 * GET /api/activity — Returns recent tool calls with joined approval, execution,
 * receipt, and agent data. Paginated and filterable.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { describeToolCall, describeRisk } from '../engine/analysis.js';

export async function activityRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/activity
   *
   * Query params:
   *  - page (default 1)
   *  - pageSize (default 50, max 200)
   *  - riskTier (optional filter: READ | WRITE | DESTRUCTIVE)
   *  - status (optional filter: pending | approved | denied | executed | auto-allowed)
   *  - agent (optional filter: agent pubkey)
   *  - search (optional: searches command/tool name)
   */
  app.get('/api/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(query.pageSize ?? '50', 10)));
    const skip = (page - 1) * pageSize;

    try {
      // Build where clause
      const where: Record<string, unknown> = {};
      if (query.riskTier) {
        where.riskTier = query.riskTier;
      }
      if (query.agent) {
        where.agentPubkey = query.agent;
      }
      if (query.search) {
        where.OR = [
          { toolName: { contains: query.search, mode: 'insensitive' } },
          { args: { contains: query.search, mode: 'insensitive' } },
        ];
      }

      // Status filter requires a more complex query
      if (query.status) {
        switch (query.status) {
          case 'pending':
            where.approval = { status: 'PENDING' };
            break;
          case 'approved':
            where.approval = { status: 'APPROVED' };
            break;
          case 'denied':
            where.approval = { status: 'DENIED' };
            break;
          case 'executed':
            where.execution = { isNot: null };
            break;
        }
      }

      const [toolCalls, total] = await Promise.all([
        prisma.toolCall.findMany({
          where,
          include: {
            agent: { select: { name: true, pubkey: true, trustLevel: true } },
            approval: true,
            execution: true,
            receipt: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        prisma.toolCall.count({ where }),
      ]);

      // Batch-resolve API key metadata for tool calls from external keys
      const apiKeyPubkeys = toolCalls
        .map((tc) => tc.agentPubkey)
        .filter((pk) => pk.startsWith('apikey:'));
      const apiKeyIds = [...new Set(apiKeyPubkeys.map((pk) => pk.slice('apikey:'.length)))];
      const apiKeyMap = new Map<string, { label: string | null; userId: string | null }>();
      if (apiKeyIds.length > 0) {
        const keys = await prisma.apiKey.findMany({
          where: { id: { in: apiKeyIds } },
          select: { id: true, label: true, userId: true },
        });
        for (const k of keys) {
          apiKeyMap.set(k.id, { label: k.label, userId: k.userId });
        }
      }

      const data = toolCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.args);
        } catch {
          // keep empty
        }

        // Determine overall status
        let status: string;
        if (tc.approval?.status === 'PENDING') {
          status = 'pending';
        } else if (tc.approval?.status === 'DENIED') {
          status = 'denied';
        } else if (tc.approval?.status === 'APPROVED') {
          status = tc.execution ? 'executed' : 'approved';
        } else if (tc.execution) {
          status = 'executed';
        } else if (tc.receipt?.policyDecision === 'ALLOW') {
          status = 'auto-allowed';
        } else if (tc.receipt?.policyDecision === 'DENY') {
          status = 'denied';
        } else {
          status = 'auto-allowed';
        }

        // Enrich with API key metadata when the caller is an external key
        let apiKeyMeta: { label: string | null; userId: string | null } | undefined;
        if (tc.agentPubkey.startsWith('apikey:')) {
          const akId = tc.agentPubkey.slice('apikey:'.length);
          apiKeyMeta = apiKeyMap.get(akId);
        }

        return {
          id: tc.id,
          toolName: tc.toolName,
          args: parsedArgs,
          riskTier: tc.riskTier,
          adapter: tc.adapter,
          taskId: tc.taskId,
          sessionId: tc.sessionId,
          status,
          createdAt: tc.createdAt.toISOString(),
          agent: {
            name: apiKeyMeta?.label ?? tc.agent.name,
            pubkey: tc.agent.pubkey,
            trustLevel: tc.agent.trustLevel,
          },
          apiKey: apiKeyMeta ? { label: apiKeyMeta.label, userId: apiKeyMeta.userId } : undefined,
          approval: tc.approval
            ? {
                id: tc.approval.id,
                status: tc.approval.status,
                approver: tc.approval.approver,
                reason: tc.approval.reason,
                ttlSeconds: tc.approval.ttlSeconds,
                createdAt: tc.approval.createdAt.toISOString(),
                decidedAt: tc.approval.decidedAt?.toISOString() ?? null,
              }
            : null,
          execution: tc.execution
            ? {
                status: tc.execution.status,
                exitCode: tc.execution.exitCode,
                durationMs: tc.execution.durationMs,
              }
            : null,
          receipt: tc.receipt
            ? {
                hash: tc.receipt.hash,
                policyDecision: tc.receipt.policyDecision,
              }
            : null,
          humanDescription: describeToolCall(tc.toolName, parsedArgs),
          riskExplanation: describeRisk(tc.riskTier, tc.toolName, parsedArgs),
        };
      });

      return reply.send({ data, total, page, pageSize });
    } catch (err) {
      request.log.error(err, 'Failed to get activity feed');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/activity/summary — Quick summary counts for the activity header.
   */
  app.get('/api/activity/summary', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const oneHourAgo = new Date(Date.now() - 3_600_000);

      const [total, pending, recentCount] = await Promise.all([
        prisma.toolCall.count(),
        prisma.approval.count({ where: { status: 'PENDING' } }),
        prisma.toolCall.count({ where: { createdAt: { gte: oneHourAgo } } }),
      ]);

      return reply.send({ total, pending, recentCount });
    } catch (err) {
      _request.log.error(err, 'Failed to get activity summary');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
