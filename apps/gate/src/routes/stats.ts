/**
 * Stats routes.
 *
 * Aggregate statistics and policy suggestions based on historical data.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PolicySuggestion } from '@wooblay/types';
import { Decision } from '@wooblay/types';
import { prisma } from '../db/client.js';

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/stats — Aggregate stats across tool calls, receipts, etc.
   */
  app.get('/api/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const [totalToolCalls, totalReceipts, pendingApprovals, agentsRegistered] =
        await Promise.all([
          prisma.toolCall.count(),
          prisma.receipt.count(),
          prisma.approval.count({ where: { status: 'PENDING' } }),
          prisma.agent.count(),
        ]);

      // Group tool calls by decision (via receipts)
      const receiptsByDecision = await prisma.receipt.groupBy({
        by: ['policyDecision'],
        _count: { policyDecision: true },
      });
      const byDecision: Record<string, number> = {};
      for (const row of receiptsByDecision) {
        byDecision[row.policyDecision] = row._count.policyDecision;
      }

      // Group tool calls by risk tier
      const callsByRisk = await prisma.toolCall.groupBy({
        by: ['riskTier'],
        _count: { riskTier: true },
      });
      const byRiskTier: Record<string, number> = {};
      for (const row of callsByRisk) {
        byRiskTier[row.riskTier] = row._count.riskTier;
      }

      // Group tool calls by tool name
      const callsByTool = await prisma.toolCall.groupBy({
        by: ['toolName'],
        _count: { toolName: true },
      });
      const byTool: Record<string, number> = {};
      for (const row of callsByTool) {
        byTool[row.toolName] = row._count.toolName;
      }

      return reply.send({
        totalToolCalls,
        totalReceipts,
        pendingApprovals,
        agentsRegistered,
        byDecision,
        byRiskTier,
        byTool,
      });
    } catch (err) {
      _request.log.error(err, 'Failed to get stats');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/stats/suggestions — Policy suggestions based on failure rates.
   *
   * If a tool has a high rate of denied-then-manually-approved calls, suggest
   * changing its default policy to ALLOW.
   */
  app.get('/api/stats/suggestions', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get all scores grouped by tool call → tool name
      const scores = await prisma.score.findMany({
        include: {
          agent: {
            include: {
              toolCalls: {
                select: { toolName: true },
                take: 1,
              },
            },
          },
        },
      });

      // Aggregate failure rates per tool name
      const toolStats = new Map<string, { total: number; failures: number }>();

      // Simpler approach: look at receipts with approval decisions
      const receiptsWithApproval = await prisma.receipt.findMany({
        where: {
          approvalDecision: { not: null },
        },
        select: {
          toolName: true,
          policyDecision: true,
          approvalDecision: true,
        },
      });

      for (const r of receiptsWithApproval) {
        const stats = toolStats.get(r.toolName) ?? { total: 0, failures: 0 };
        stats.total++;
        if (r.approvalDecision === 'DENIED') {
          stats.failures++;
        }
        toolStats.set(r.toolName, stats);
      }

      const suggestions: PolicySuggestion[] = [];

      for (const [toolName, stats] of toolStats) {
        if (stats.total < 5) continue; // Not enough data

        const failureRate = stats.failures / stats.total;
        const approvalRate = 1 - failureRate;

        // If >80% of reviewed calls are approved, suggest auto-allow
        if (approvalRate > 0.8) {
          suggestions.push({
            toolName,
            currentDecision: Decision.APPROVE,
            suggestedDecision: Decision.ALLOW,
            reason: `${(approvalRate * 100).toFixed(0)}% of reviewed calls were approved`,
            failureRate,
            sampleSize: stats.total,
          });
        }

        // If >60% are denied, suggest auto-deny
        if (failureRate > 0.6) {
          suggestions.push({
            toolName,
            currentDecision: Decision.APPROVE,
            suggestedDecision: Decision.DENY,
            reason: `${(failureRate * 100).toFixed(0)}% of reviewed calls were denied`,
            failureRate,
            sampleSize: stats.total,
          });
        }
      }

      return reply.send(suggestions);
    } catch (err) {
      _request.log.error(err, 'Failed to get suggestions');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
