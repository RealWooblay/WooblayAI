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
import { classifyRisk, classifyCategory, classifyWithAI } from '../engine/risk.js';
import { evaluatePolicy } from '../engine/policy.js';
import { createReceipt } from '../engine/receipt.js';
import { createApproval } from '../services/approval.js';
import { validateBody } from '../middleware/validate.js';
import { describeToolCall, explainWhyFlagged } from '../engine/analysis.js';
import { detectFlags } from '../engine/flags.js';

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

        // 1. Classify risk tier and business category
        //    Layer 1: Structural (fast, deterministic) — the baseline
        const structuralRisk = classifyRisk(body.toolName, body.args);
        const structuralCategory = classifyCategory(body.toolName, body.args);

        //    Layer 2: AI (smart, contextual) — can ESCALATE, never downgrade
        //    This is what catches `cat /etc/shadow`, suspicious downloads, etc.
        //    without us having to hardcode every possible sensitive path.
        let riskTier = structuralRisk;
        let category = structuralCategory;
        let aiDescription: string | null = null;
        let aiWhyReview: string | null = null;

        try {
          const aiResult = await classifyWithAI(body.toolName, body.args, structuralRisk, structuralCategory);
          if (aiResult) {
            riskTier = aiResult.riskTier;
            category = aiResult.category;
            aiDescription = aiResult.description || null;
            aiWhyReview = aiResult.whyReview || null;
            if (riskTier !== structuralRisk || category !== structuralCategory) {
              request.log.info(
                `[AI] Reclassified: ${structuralRisk}/${structuralCategory} → ${riskTier}/${category} — ${aiResult.reasoning}`,
              );
            }
          }
        } catch (err) {
          request.log.warn(err, 'AI classification failed, using structural fallback');
        }

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
            category,
            adapter: body.adapter ?? null,
          },
        });

        // 3b. Resolve instance for this agent (for role-aware flag detection)
        // MVP: match by most recently active running instance
        const agentInstance = await prisma.instance.findFirst({
          where: { status: 'running' },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });

        // 3c. Run flag detection async (non-blocking)
        detectFlags(prisma, {
          toolCallId: toolCall.id,
          agentPubkey: body.agentPubkey,
          toolName: body.toolName,
          args: argsCanonical,
          riskTier,
          category,
          instanceId: agentInstance?.id ?? null,
        }).catch((err) => request.log.warn(err, 'Flag detection failed'));

        // 4. Evaluate policy (instance-specific rules override globals)
        const policyDecision = await evaluatePolicy(prisma, toolCall, agentInstance?.id ?? null);
        const decisionTrail = body.decisionTrail ?? defaultTrail;

        // 4b. Human-readable enrichment
        //     AI descriptions take priority — they understand context, not just syntax.
        //     Regex fallback exists for when AI is unavailable.
        const parsedArgs = typeof body.args === 'string' ? JSON.parse(body.args) : body.args;
        const description = aiDescription || describeToolCall(body.toolName, parsedArgs);
        const whyFlagged = aiWhyReview
          || explainWhyFlagged(riskTier, body.toolName, policyDecision.decision, parsedArgs);

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
              description,
              riskTier,
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
              description,
              whyFlagged,
              riskTier,
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
              description,
              whyFlagged,
              riskTier,
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
