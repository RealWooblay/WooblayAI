/**
 * Approval routes.
 *
 * Provides endpoints to list, inspect, approve, and deny pending tool call
 * approvals.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApprovalDecisionRequestSchema } from '@wooblay/schemas';
import { ApprovalStatus } from '@wooblay/types';
import { prisma } from '../db/client.js';
import { resolveApproval } from '../services/approval.js';
import { createReceipt } from '../engine/receipt.js';
import { validateBody } from '../middleware/validate.js';
import { describeToolCall, describeRisk, explainWhyFlagged } from '../engine/analysis.js';
import { classifyWithAI, classifyRisk, classifyCategory } from '../engine/risk.js';

// In-memory cache for AI descriptions. Key: toolCallId, Value: { description, whyReview }
// Prevents redundant AI calls when the frontend polls for pending approvals.
const aiDescriptionCache = new Map<string, { description: string; whyReview: string | null }>();

export async function approvalRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/approvals/pending — List all pending approvals.
   */
  app.get('/api/approvals/pending', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const approvals = await prisma.approval.findMany({
        where: { status: 'PENDING' },
        include: { toolCall: true },
        orderBy: { createdAt: 'desc' },
      });

      // Enrich with AI descriptions — the AI understands WHAT the action does
      // and WHY it needs review, not just pattern matching.
      const enriched = await Promise.all(approvals.map(async (approval) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(approval.toolCall.args);
        } catch {
          // keep empty
        }

        // Check cache first
        let aiDesc = aiDescriptionCache.get(approval.toolCallId);
        if (!aiDesc) {
          // Try AI classification for smart descriptions
          try {
            const structRisk = classifyRisk(approval.toolCall.toolName, parsedArgs);
            const structCat = classifyCategory(approval.toolCall.toolName, parsedArgs);
            const aiResult = await classifyWithAI(approval.toolCall.toolName, parsedArgs, structRisk, structCat);
            if (aiResult?.description) {
              aiDesc = { description: aiResult.description, whyReview: aiResult.whyReview };
              aiDescriptionCache.set(approval.toolCallId, aiDesc);
              // Evict old entries (keep cache small)
              if (aiDescriptionCache.size > 200) {
                const firstKey = aiDescriptionCache.keys().next().value;
                if (firstKey) aiDescriptionCache.delete(firstKey);
              }
            }
          } catch {
            // AI unavailable — fall through to regex
          }
        }

        const fallbackDescription = describeToolCall(approval.toolCall.toolName, parsedArgs);
        const fallbackRisk = describeRisk(approval.toolCall.riskTier, approval.toolCall.toolName, parsedArgs);
        const fallbackWhy = explainWhyFlagged(approval.toolCall.riskTier, approval.toolCall.toolName, 'APPROVE', parsedArgs);

        return {
          ...approval,
          humanDescription: aiDesc?.description || fallbackDescription,
          riskExplanation: aiDesc?.whyReview || fallbackRisk,
          whyFlagged: aiDesc?.whyReview || fallbackWhy,
        };
      }));

      return reply.send(enriched);
    } catch (err) {
      _request.log.error(err, 'Failed to list pending approvals');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/approvals/:id — Get a single approval by ID.
   */
  app.get('/api/approvals/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const approval = await prisma.approval.findUnique({
        where: { id },
        include: { toolCall: true },
      });

      if (!approval) {
        return reply.code(404).send({ error: 'Approval not found' });
      }

      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(approval.toolCall.args);
      } catch {
        // keep empty
      }

      // Try AI-powered descriptions first
      let aiDesc = aiDescriptionCache.get(approval.toolCallId);
      if (!aiDesc) {
        try {
          const structRisk = classifyRisk(approval.toolCall.toolName, parsedArgs);
          const structCat = classifyCategory(approval.toolCall.toolName, parsedArgs);
          const aiResult = await classifyWithAI(approval.toolCall.toolName, parsedArgs, structRisk, structCat);
          if (aiResult?.description) {
            aiDesc = { description: aiResult.description, whyReview: aiResult.whyReview };
            aiDescriptionCache.set(approval.toolCallId, aiDesc);
          }
        } catch {
          // AI unavailable — fall through to regex
        }
      }

      const fallbackDesc = describeToolCall(approval.toolCall.toolName, parsedArgs);
      const fallbackRisk = describeRisk(approval.toolCall.riskTier, approval.toolCall.toolName, parsedArgs);
      const fallbackWhy = explainWhyFlagged(approval.toolCall.riskTier, approval.toolCall.toolName, 'APPROVE', parsedArgs);

      return reply.send({
        ...approval,
        humanDescription: aiDesc?.description || fallbackDesc,
        riskExplanation: aiDesc?.whyReview || fallbackRisk,
        whyFlagged: aiDesc?.whyReview || fallbackWhy,
      });
    } catch (err) {
      request.log.error(err, 'Failed to get approval');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/approvals/:id/approve — Approve a pending tool call.
   */
  app.post(
    '/api/approvals/:id/approve',
    { preHandler: validateBody(ApprovalDecisionRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { approver: string; reason?: string };

      try {
        const approval = await prisma.approval.findUnique({
          where: { id },
          include: { toolCall: true },
        });

        if (!approval) {
          return reply.code(404).send({ error: 'Approval not found' });
        }
        if (approval.status !== 'PENDING') {
          return reply.code(409).send({ error: `Approval already ${approval.status}` });
        }

        // Resolve the approval
        await resolveApproval(prisma, id, ApprovalStatus.APPROVED, body.approver, body.reason);

        // Create a receipt for the approved decision
        const receipt = await createReceipt(prisma, {
          toolCallId: approval.toolCallId,
          agentPubkey: approval.toolCall.agentPubkey,
          toolName: approval.toolCall.toolName,
          riskTier: approval.toolCall.riskTier,
          policyDecision: 'APPROVE',
          approvalDecision: 'APPROVED',
          approver: body.approver,
          decisionTrail: {
            plan_summary: 'Human-approved tool call',
            reason_summary: body.reason ?? 'Approved by operator',
            inputs_used: [],
            citations: [],
          },
        });

        return reply.send({
          decision: 'EXECUTE',
          toolCallId: approval.toolCallId,
          approvalId: id,
          receiptId: receipt.id,
        });
      } catch (err) {
        request.log.error(err, 'Failed to approve');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /api/approvals/:id/deny — Deny a pending tool call.
   */
  app.post(
    '/api/approvals/:id/deny',
    { preHandler: validateBody(ApprovalDecisionRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { approver: string; reason?: string };

      try {
        const approval = await prisma.approval.findUnique({
          where: { id },
          include: { toolCall: true },
        });

        if (!approval) {
          return reply.code(404).send({ error: 'Approval not found' });
        }
        if (approval.status !== 'PENDING') {
          return reply.code(409).send({ error: `Approval already ${approval.status}` });
        }

        // Resolve the approval
        await resolveApproval(prisma, id, ApprovalStatus.DENIED, body.approver, body.reason);

        // Create a receipt for the denied decision
        const receipt = await createReceipt(prisma, {
          toolCallId: approval.toolCallId,
          agentPubkey: approval.toolCall.agentPubkey,
          toolName: approval.toolCall.toolName,
          riskTier: approval.toolCall.riskTier,
          policyDecision: 'APPROVE',
          approvalDecision: 'DENIED',
          approver: body.approver,
          decisionTrail: {
            plan_summary: 'Human-denied tool call',
            reason_summary: body.reason ?? 'Denied by operator',
            inputs_used: [],
            citations: [],
          },
        });

        return reply.send({
          decision: 'DENY',
          toolCallId: approval.toolCallId,
          approvalId: id,
          receiptId: receipt.id,
        });
      } catch (err) {
        request.log.error(err, 'Failed to deny');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );
}
