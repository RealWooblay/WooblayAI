/**
 * Session status routes.
 *
 * GET /api/sessions — List all active sessions with summary stats.
 * GET /api/sessions/:sessionKey/status — Full timeline of tool calls in a session.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { describeToolCall, describeRisk } from '../engine/analysis.js';

export async function sessionRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/sessions — List distinct sessions with summary stats.
   */
  app.get('/api/sessions', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Get distinct sessions with their latest activity
      const rawSessions = await prisma.toolCall.groupBy({
        by: ['sessionId'],
        _count: { id: true },
        _max: { createdAt: true },
        _min: { createdAt: true },
        where: { sessionId: { not: null } },
        orderBy: { _max: { createdAt: 'desc' } },
        take: 100,
      });

      const sessions = await Promise.all(
        rawSessions.map(async (s) => {
          if (!s.sessionId) return null;

          // Get pending count for this session
          const pendingCount = await prisma.approval.count({
            where: {
              status: 'PENDING',
              toolCall: { sessionId: s.sessionId },
            },
          });

          // Get agent info from first tool call in session
          const firstCall = await prisma.toolCall.findFirst({
            where: { sessionId: s.sessionId },
            include: { agent: { select: { name: true, pubkey: true } } },
            orderBy: { createdAt: 'asc' },
          });

          return {
            sessionKey: s.sessionId,
            toolCallCount: s._count.id,
            pendingApprovals: pendingCount,
            startedAt: s._min.createdAt?.toISOString() ?? null,
            lastActivityAt: s._max.createdAt?.toISOString() ?? null,
            agent: firstCall?.agent ?? null,
          };
        }),
      );

      return reply.send(sessions.filter(Boolean));
    } catch (err) {
      _request.log.error(err, 'Failed to list sessions');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/sessions/:sessionKey/status — Full session status with step-by-step timeline.
   */
  app.get('/api/sessions/:sessionKey/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const { sessionKey } = request.params as { sessionKey: string };

    try {
      const toolCalls = await prisma.toolCall.findMany({
        where: { sessionId: sessionKey },
        include: {
          agent: { select: { name: true, pubkey: true, trustLevel: true } },
          approval: true,
          execution: true,
          receipt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      if (toolCalls.length === 0) {
        return reply.code(404).send({ error: 'Session not found or has no tool calls' });
      }

      const agent = toolCalls[0].agent;

      const steps = toolCalls.map((tc, index) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.args);
        } catch {
          // keep empty
        }

        // Determine step status
        let stepStatus: string;
        if (tc.approval?.status === 'PENDING') {
          stepStatus = 'blocked';
        } else if (tc.approval?.status === 'DENIED') {
          stepStatus = 'denied';
        } else if (tc.execution) {
          stepStatus = tc.execution.exitCode === 0 ? 'completed' : 'failed';
        } else if (tc.receipt?.policyDecision === 'ALLOW') {
          stepStatus = 'completed';
        } else if (tc.receipt?.policyDecision === 'DENY') {
          stepStatus = 'denied';
        } else {
          stepStatus = 'completed';
        }

        // Check if this is a deferred approval
        const isDeferred =
          tc.approval?.status === 'PENDING' &&
          tc.approval?.ttlSeconds > 3600;

        return {
          stepNumber: index + 1,
          id: tc.id,
          toolName: tc.toolName,
          args: parsedArgs,
          riskTier: tc.riskTier,
          adapter: tc.adapter,
          status: stepStatus,
          isDeferred,
          createdAt: tc.createdAt.toISOString(),
          humanDescription: describeToolCall(tc.toolName, parsedArgs),
          riskExplanation: describeRisk(tc.riskTier, tc.toolName, parsedArgs),
          approval: tc.approval
            ? {
                id: tc.approval.id,
                status: tc.approval.status,
                approver: tc.approval.approver,
                reason: tc.approval.reason,
                ttlSeconds: tc.approval.ttlSeconds,
                decidedAt: tc.approval.decidedAt?.toISOString() ?? null,
              }
            : null,
          execution: tc.execution
            ? {
                status: tc.execution.status,
                exitCode: tc.execution.exitCode,
                durationMs: tc.execution.durationMs,
                stdout: tc.execution.stdout?.slice(0, 1000) ?? null,
                stderr: tc.execution.stderr?.slice(0, 500) ?? null,
              }
            : null,
          receipt: tc.receipt
            ? { hash: tc.receipt.hash, policyDecision: tc.receipt.policyDecision }
            : null,
        };
      });

      const completedSteps = steps.filter((s) => s.status === 'completed').length;
      const blockedSteps = steps.filter((s) => s.status === 'blocked').length;
      const failedSteps = steps.filter((s) => s.status === 'failed').length;
      const deniedSteps = steps.filter((s) => s.status === 'denied').length;

      return reply.send({
        sessionKey,
        agent: {
          name: agent.name,
          pubkey: agent.pubkey,
          trustLevel: agent.trustLevel,
        },
        summary: {
          totalSteps: steps.length,
          completed: completedSteps,
          blocked: blockedSteps,
          failed: failedSteps,
          denied: deniedSteps,
        },
        startedAt: toolCalls[0].createdAt.toISOString(),
        lastActivityAt: toolCalls[toolCalls.length - 1].createdAt.toISOString(),
        steps,
      });
    } catch (err) {
      request.log.error(err, 'Failed to get session status');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
