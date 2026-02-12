/**
 * Mission & observability routes.
 *
 * Provides high-level views of what agents are doing:
 *   - Mission cards (per-instance summary)
 *   - Trust scores
 *   - Cost summaries
 *   - Contribution analytics
 *   - Session playback
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { describeToolCall } from '../engine/analysis.js';
import { computeTrustScore } from '../engine/trust.js';
import { computeCostSummary } from '../engine/cost.js';
import { computeContributions } from '../engine/contributions.js';
import { summarizeSession, isAIEnabled } from '../services/ai-supervisor.js';

export async function missionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/instances/:id/mission — Mission card data for an instance.
   */
  app.get('/api/instances/:id/mission', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      // Find the agent associated with this instance (by matching tool calls from this instance's agents)
      // For MVP, we look at all agents (in production we'd filter by instance container)
      const agents = await prisma.agent.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const effectiveRole = instance.role ?? instance.inferredRole ?? null;

      const agentPubkey = agents[0]?.pubkey;
      if (!agentPubkey) {
        return reply.send({
          instanceId: id,
          instanceName: instance.name,
          status: instance.status,
          goal: instance.name,
          currentStep: 'No activity yet',
          progress: { total: 0, completed: 0, pending: 0, denied: 0 },
          pipeline: { PLANNING: 0, EXECUTING: 0, AWAITING_APPROVAL: 0, COMPLETED: 0 },
          blockedActions: 0,
          subAgents: [],
          trustScore: 70,
          trustTrend: 'stable' as const,
          estimatedCost: 0,
          role: effectiveRole,
          inferredRole: instance.inferredRole,
          roleOverridden: !!instance.role,
        });
      }

      // Recent tool calls
      const recentCalls = await prisma.toolCall.findMany({
        where: { agentPubkey },
        include: { approval: true, receipt: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      // Pipeline classification
      let planning = 0, executing = 0, awaitingApproval = 0, completed = 0;
      for (const tc of recentCalls) {
        const tool = tc.toolName.replace(/^(gated_|wooblay_)/, '');
        if (tc.approval?.status === 'PENDING') {
          awaitingApproval++;
        } else if (tc.receipt) {
          completed++;
        } else if (['read', 'web_search', 'memory_search', 'memory_get', 'sessions_list', 'session_status'].includes(tool)) {
          planning++;
        } else {
          executing++;
        }
      }

      // Last action description
      let parsedArgs: Record<string, unknown> = {};
      try {
        if (recentCalls[0]) parsedArgs = JSON.parse(recentCalls[0].args);
      } catch {
        // keep empty
      }
      const currentStep = recentCalls[0]
        ? describeToolCall(recentCalls[0].toolName, parsedArgs)
        : 'Idle';

      // Pending approvals
      const pendingCount = await prisma.approval.count({
        where: { status: 'PENDING', toolCall: { agentPubkey } },
      });

      // Denied count
      const deniedCount = recentCalls.filter(
        (tc) => tc.receipt?.policyDecision === 'DENY' || tc.approval?.status === 'DENIED',
      ).length;

      // Sub-agents (distinct sessionIds)
      const sessionIds = [...new Set(recentCalls.map((tc) => tc.sessionId).filter(Boolean))];
      const subAgents = sessionIds.slice(0, 5).map((sessionId) => {
        const lastCall = recentCalls.find((tc) => tc.sessionId === sessionId);
        let lastArgs: Record<string, unknown> = {};
        try {
          if (lastCall) lastArgs = JSON.parse(lastCall.args);
        } catch {
          // keep empty
        }
        return {
          sessionId,
          lastAction: lastCall ? describeToolCall(lastCall.toolName, lastArgs) : 'Unknown',
          status: lastCall?.approval?.status === 'PENDING' ? 'awaiting_approval' : 'active',
        };
      });

      // Trust score
      const trust = await computeTrustScore(prisma, agentPubkey);

      // Cost
      const cost = await computeCostSummary(prisma, { agentPubkey });

      // Category breakdown
      const categoryBreakdown: Record<string, number> = {};
      for (const tc of recentCalls) {
        const cat = (tc as any).category ?? 'other';
        categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + 1;
      }

      // Last action with category
      const lastActionCategory = recentCalls[0] ? ((recentCalls[0] as any).category ?? 'other') : null;

      return reply.send({
        instanceId: id,
        instanceName: instance.name,
        status: instance.status,
        goal: instance.name,
        currentStep,
        progress: {
          total: recentCalls.length,
          completed,
          pending: awaitingApproval,
          denied: deniedCount,
        },
        pipeline: {
          PLANNING: planning,
          EXECUTING: executing,
          AWAITING_APPROVAL: awaitingApproval,
          COMPLETED: completed,
        },
        blockedActions: pendingCount,
        subAgents,
        trustScore: trust.score,
        trustTrend: trust.trend,
        estimatedCost: cost.costToday,
        costBurnRate: cost.burnRatePerHour,
        role: effectiveRole,
        inferredRole: instance.inferredRole,
        roleOverridden: !!instance.role,
        categoryBreakdown,
        lastActionCategory,
      });
    } catch (err) {
      request.log.error(err, 'Failed to get mission data');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agents/:pubkey/trust — Agent trust score.
   */
  app.get('/api/agents/:pubkey/trust', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pubkey } = request.params as { pubkey: string };
    try {
      const result = await computeTrustScore(prisma, pubkey);
      return reply.send(result);
    } catch (err) {
      request.log.error(err, 'Failed to compute trust score');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/instances/:id/cost — Cost summary for an instance.
   */
  app.get('/api/instances/:id/cost', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      // For MVP, compute cost across all agents (instance-scoped would filter by container)
      const result = await computeCostSummary(prisma, {});
      return reply.send(result);
    } catch (err) {
      request.log.error(err, 'Failed to compute cost');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agents/:pubkey/contributions — Agent contribution analytics.
   */
  app.get('/api/agents/:pubkey/contributions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pubkey } = request.params as { pubkey: string };
    try {
      const result = await computeContributions(prisma, { agentPubkey: pubkey });
      return reply.send(result);
    } catch (err) {
      request.log.error(err, 'Failed to compute contributions');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/instances/:id/contributions — Instance contribution analytics.
   */
  app.get('/api/instances/:id/contributions', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const agents = await prisma.agent.findMany({ orderBy: { createdAt: 'desc' }, take: 1 });
      const agentPubkey = agents[0]?.pubkey;
      const result = await computeContributions(prisma, { agentPubkey });
      return reply.send(result);
    } catch (err) {
      request.log.error(err, 'Failed to compute contributions');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/sessions/:sessionId/playback — Session playback data.
   */
  app.get('/api/sessions/:sessionId/playback', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionId } = request.params as { sessionId: string };

    try {
      const toolCalls = await prisma.toolCall.findMany({
        where: { sessionId },
        include: {
          approval: true,
          execution: true,
          receipt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (toolCalls.length === 0) {
        return reply.code(404).send({ error: 'Session not found or has no activity' });
      }

      const events = toolCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.args);
        } catch {
          // keep empty
        }

        let status: string;
        let color: string;
        if (tc.receipt?.policyDecision === 'DENY' || tc.approval?.status === 'DENIED') {
          status = 'denied';
          color = 'red';
        } else if (tc.receipt?.policyDecision === 'ALLOW') {
          status = 'auto-allowed';
          color = 'blue';
        } else if (tc.approval?.status === 'APPROVED') {
          status = 'human-approved';
          color = 'yellow';
        } else if (tc.approval?.status === 'PENDING') {
          status = 'pending';
          color = 'amber';
        } else {
          status = 'completed';
          color = 'green';
        }

        return {
          id: tc.id,
          timestamp: tc.createdAt.toISOString(),
          toolName: tc.toolName,
          description: describeToolCall(tc.toolName, parsedArgs),
          riskTier: tc.riskTier,
          status,
          color,
          approver: tc.approval?.approver ?? null,
          approvalWaitMs: tc.approval?.decidedAt && tc.approval?.createdAt
            ? new Date(tc.approval.decidedAt).getTime() - new Date(tc.approval.createdAt).getTime()
            : null,
          executionResult: tc.execution
            ? { status: tc.execution.status, exitCode: tc.execution.exitCode, durationMs: tc.execution.durationMs }
            : null,
          receiptHash: tc.receipt?.hash ?? null,
        };
      });

      // Stats
      const totalDurationMs = toolCalls.length > 1
        ? new Date(toolCalls[toolCalls.length - 1].createdAt).getTime() - new Date(toolCalls[0].createdAt).getTime()
        : 0;
      const decisionsMade = events.filter((e) => e.status !== 'pending').length;
      const avgApprovalMs = events
        .filter((e) => e.approvalWaitMs !== null)
        .reduce((sum, e) => sum + (e.approvalWaitMs ?? 0), 0) /
        (events.filter((e) => e.approvalWaitMs !== null).length || 1);

      // AI session summary (if enabled)
      let aiSummary = null;
      if (isAIEnabled()) {
        try {
          aiSummary = await summarizeSession(events.map((e) => ({
            toolName: e.toolName,
            description: e.description,
            riskTier: e.riskTier,
            status: e.status,
            timestamp: e.timestamp,
          })));
        } catch {
          // Non-critical
        }
      }

      return reply.send({
        sessionId,
        events,
        stats: {
          totalEvents: events.length,
          totalDurationMs,
          decisionsMade,
          avgApprovalTimeMs: Math.round(avgApprovalMs),
          denied: events.filter((e) => e.status === 'denied').length,
          autoAllowed: events.filter((e) => e.status === 'auto-allowed').length,
          humanApproved: events.filter((e) => e.status === 'human-approved').length,
        },
        aiSummary,
      });
    } catch (err) {
      request.log.error(err, 'Failed to get session playback');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
