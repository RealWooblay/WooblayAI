/**
 * Tool execution route.
 *
 * POST /api/tool/execute — The primary Gate endpoint. Receives a tool call
 * request, classifies its risk, evaluates policy, and returns one of:
 *   - EXECUTE  (proceed immediately)
 *   - DENY     (blocked by policy)
 *   - PENDING_APPROVAL (human review required)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ToolExecuteRequestSchema } from '@wooblay/schemas';
import { canonicalJson } from '@wooblay/crypto';
import type { ToolExecuteRequest, DecisionTrail } from '@wooblay/types';
import { Decision } from '@wooblay/types';
import { prisma } from '../db/client.js';
import { classifyRisk } from '../engine/risk.js';
import { evaluatePolicy } from '../engine/policy.js';
import { createReceipt } from '../engine/receipt.js';
import { createApproval } from '../services/approval.js';
import { validateBody } from '../middleware/validate.js';

/** Default decision trail when none is provided by the agent. */
const defaultTrail: DecisionTrail = {
  plan_summary: 'No plan provided',
  reason_summary: 'No reason provided',
  inputs_used: [],
  citations: [],
};

export async function toolRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/tool/execute',
    { preHandler: validateBody(ToolExecuteRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as ToolExecuteRequest;

      try {
        // 0. Auto-register agent if not found (managed runtime self-registration)
        //    In a managed runtime, the adapter plugin is trusted and runs in-process.
        const existingAgent = await prisma.agent.findUnique({
          where: { pubkey: body.agentPubkey },
        });
        if (!existingAgent) {
          await prisma.agent.create({
            data: {
              pubkey: body.agentPubkey,
              name: body.adapter ?? body.agentPubkey,
              allowlisted: true,
              status: 'active',
            },
          });
          request.log.info(`Auto-registered agent: ${body.agentPubkey} (adapter: ${body.adapter})`);
        }

        // 1. Classify risk tier
        const riskTier = classifyRisk(body.toolName, body.args);

        // 2. Canonicalize args for storage
        const argsCanonical = canonicalJson(body.args);

        // 3. Create the ToolCall record
        const toolCall = await prisma.toolCall.create({
          data: {
            taskId: body.taskId ?? null,
            sessionId: body.sessionId ?? null,
            agentPubkey: body.agentPubkey,
            toolName: body.toolName,
            args: argsCanonical,
            riskTier,
            adapter: body.adapter ?? null,
          },
        });

        // 3b. Analysis now runs via event bus on receipt.created (see server.ts)

        // 4. Evaluate policy
        const policyDecision = await evaluatePolicy(prisma, toolCall);
        const decisionTrail = body.decisionTrail ?? defaultTrail;

        // 5. Handle the decision
        switch (policyDecision.decision) {
          case Decision.ALLOW: {
            // ALLOW → EXECUTE immediately
            const receipt = await createReceipt(prisma, {
              toolCallId: toolCall.id,
              agentPubkey: body.agentPubkey,
              toolName: body.toolName,
              riskTier,
              policyDecision: policyDecision.decision,
              policyRuleId: policyDecision.ruleId ?? null,
              decisionTrail,
            });

            return reply.code(200).send({
              decision: 'EXECUTE',
              toolCallId: toolCall.id,
              receiptId: receipt.id,
              reason: policyDecision.reason,
            });
          }

          case Decision.DENY: {
            // DENY → blocked
            const receipt = await createReceipt(prisma, {
              toolCallId: toolCall.id,
              agentPubkey: body.agentPubkey,
              toolName: body.toolName,
              riskTier,
              policyDecision: policyDecision.decision,
              policyRuleId: policyDecision.ruleId ?? null,
              decisionTrail,
            });

            return reply.code(200).send({
              decision: 'DENY',
              toolCallId: toolCall.id,
              receiptId: receipt.id,
              reason: policyDecision.reason,
            });
          }

          case Decision.APPROVE: {
            // APPROVE → human review required
            const approval = await createApproval(prisma, toolCall.id);

            return reply.code(200).send({
              decision: 'PENDING_APPROVAL',
              toolCallId: toolCall.id,
              approvalId: approval.id,
              reason: policyDecision.reason,
            });
          }

          default:
            return reply.code(500).send({ error: 'Unknown policy decision' });
        }
      } catch (err) {
        request.log.error(err, 'Tool execution failed');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );
}
