/**
 * AI Analysis routes.
 *
 * On-demand AI-powered analysis endpoints for agent supervision.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { describeToolCall } from '../engine/analysis.js';
import {
  isAIEnabled,
  assessThreat,
  analyzeBehavior,
  assessContributions,
  summarizeSession,
} from '../services/ai-supervisor.js';

export async function aiAnalysisRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/ai/status — Check if AI analysis is enabled.
   */
  app.get('/api/ai/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      enabled: isAIEnabled(),
      model: isAIEnabled() ? process.env['OPENAI_MODEL'] ?? 'gpt-4.1-mini' : null,
    });
  });

  /**
   * POST /api/ai/analyze-agent — Full behavioral analysis for an agent.
   *
   * Body: { agentPubkey: string }
   */
  app.post('/api/ai/analyze-agent', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAIEnabled()) {
      return reply.code(503).send({ error: 'AI analysis not configured. Set OPENAI_API_KEY.' });
    }

    const { agentPubkey } = request.body as { agentPubkey: string };
    if (!agentPubkey) {
      return reply.code(400).send({ error: 'agentPubkey is required' });
    }

    try {
      const actions = await prisma.toolCall.findMany({
        where: { agentPubkey },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          approval: { select: { status: true } },
          receipt: { select: { policyDecision: true } },
        },
      });

      const enriched = actions.map((a) => ({
        toolName: a.toolName,
        args: a.args,
        riskTier: a.riskTier,
        createdAt: a.createdAt.toISOString(),
        status: a.approval?.status === 'DENIED' ? 'denied'
          : a.approval?.status === 'APPROVED' ? 'approved'
          : a.receipt?.policyDecision === 'ALLOW' ? 'auto-allowed'
          : a.receipt?.policyDecision === 'DENY' ? 'denied'
          : 'pending',
      }));

      const patterns = await analyzeBehavior(agentPubkey, enriched);

      // Store any findings as flags
      for (const p of patterns) {
        await prisma.auditFlag.create({
          data: {
            severity: p.severity,
            category: `ai_${p.pattern}`,
            title: `AI: ${p.title}`,
            description: p.description + '\n\nEvidence:\n' + p.evidence.map((e: string) => `• ${e}`).join('\n'),
            agentPubkey,
            metadata: JSON.stringify({ pattern: p.pattern, evidence: p.evidence, model: 'ai-supervisor' }),
          },
        });
      }

      return reply.send({
        agentPubkey,
        actionsAnalyzed: actions.length,
        patterns,
        flagsCreated: patterns.length,
      });
    } catch (err) {
      request.log.error(err, 'AI agent analysis failed');
      return reply.code(500).send({ error: 'Analysis failed' });
    }
  });

  /**
   * POST /api/ai/summarize-session — AI summary of a session.
   *
   * Body: { sessionId: string }
   */
  app.post('/api/ai/summarize-session', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAIEnabled()) {
      return reply.code(503).send({ error: 'AI analysis not configured. Set OPENAI_API_KEY.' });
    }

    const { sessionId } = request.body as { sessionId: string };
    if (!sessionId) {
      return reply.code(400).send({ error: 'sessionId is required' });
    }

    try {
      const toolCalls = await prisma.toolCall.findMany({
        where: { sessionId },
        include: { approval: true, receipt: true },
        orderBy: { createdAt: 'asc' },
      });

      const events = toolCalls.map((tc) => {
        let parsedArgs: Record<string, unknown> = {};
        try { parsedArgs = JSON.parse(tc.args); } catch { /* empty */ }

        return {
          toolName: tc.toolName,
          description: describeToolCall(tc.toolName, parsedArgs),
          riskTier: tc.riskTier,
          status: tc.receipt?.policyDecision === 'DENY' ? 'denied'
            : tc.approval?.status === 'DENIED' ? 'denied'
            : tc.receipt?.policyDecision === 'ALLOW' ? 'auto-allowed'
            : tc.approval?.status === 'APPROVED' ? 'approved'
            : 'pending',
          timestamp: tc.createdAt.toISOString(),
        };
      });

      const summary = await summarizeSession(events);

      return reply.send({
        sessionId,
        eventsCount: events.length,
        summary,
      });
    } catch (err) {
      request.log.error(err, 'AI session summary failed');
      return reply.code(500).send({ error: 'Summary failed' });
    }
  });

  /**
   * POST /api/ai/assess-contributions — AI assessment of agent contributions.
   *
   * Body: { agentPubkey?: string, instanceId?: string }
   */
  app.post('/api/ai/assess-contributions', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAIEnabled()) {
      return reply.code(503).send({ error: 'AI analysis not configured. Set OPENAI_API_KEY.' });
    }

    const { agentPubkey, instanceId } = request.body as { agentPubkey?: string; instanceId?: string };

    try {
      const where: Record<string, unknown> = {};
      if (agentPubkey) where.agentPubkey = agentPubkey;

      const actions = await prisma.toolCall.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          receipt: { select: { policyDecision: true, approvalDecision: true } },
        },
      });

      const assessment = await assessContributions(
        actions.map((a) => ({
          toolName: a.toolName,
          args: a.args,
          status: a.receipt?.policyDecision === 'DENY' ? 'denied'
            : a.receipt?.approvalDecision === 'DENIED' ? 'denied'
            : a.receipt?.policyDecision === 'ALLOW' ? 'auto-allowed'
            : 'approved',
          createdAt: a.createdAt.toISOString(),
        })),
      );

      return reply.send({
        actionsAnalyzed: actions.length,
        assessment,
      });
    } catch (err) {
      request.log.error(err, 'AI contribution assessment failed');
      return reply.code(500).send({ error: 'Assessment failed' });
    }
  });
}
