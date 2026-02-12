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

      const enriched = approvals.map((approval) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(approval.toolCall.args);
        } catch {
          // keep empty
        }
        return {
          ...approval,
          humanDescription: describeToolCall(approval.toolCall.toolName, parsedArgs),
          riskExplanation: describeRisk(approval.toolCall.riskTier, approval.toolCall.toolName, parsedArgs),
          whyFlagged: explainWhyFlagged(approval.toolCall.riskTier, approval.toolCall.toolName, 'APPROVE', parsedArgs),
        };
      });

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

      return reply.send({
        ...approval,
        humanDescription: describeToolCall(approval.toolCall.toolName, parsedArgs),
        riskExplanation: describeRisk(approval.toolCall.riskTier, approval.toolCall.toolName, parsedArgs),
        whyFlagged: explainWhyFlagged(approval.toolCall.riskTier, approval.toolCall.toolName, 'APPROVE', parsedArgs),
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
