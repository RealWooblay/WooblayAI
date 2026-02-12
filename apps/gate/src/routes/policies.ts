/**
 * Policy management routes.
 *
 * CRUD for policy rules + preset application.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { ALL_PRESETS } from '../db/seed-policies.js';
import { isAIEnabled } from '../services/ai-supervisor.js';
import OpenAI from 'openai';
import { config } from '../config.js';

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/policies — List all policy rules ordered by priority.
   */
  app.get('/api/policies', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const rules = await prisma.policyRule.findMany({
        orderBy: { priority: 'asc' },
      });
      return reply.send(rules);
    } catch (err) {
      _request.log.error(err, 'Failed to list policies');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/policies — Create a new policy rule.
   *
   * Body: { matchTool, riskTier, decision, matchArgs?, constraints?, enabled? }
   * Priority is auto-assigned (max + 10).
   */
  app.post('/api/policies', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      matchTool: string;
      riskTier: string;
      decision: string;
      matchArgs?: string;
      matchCategory?: string;
      constraints?: string;
      source?: string;
      description?: string;
      enabled?: boolean;
    };

    if (!body.matchTool || !body.riskTier || !body.decision) {
      return reply.code(400).send({ error: 'matchTool, riskTier, and decision are required' });
    }

    const validDecisions = ['ALLOW', 'DENY', 'APPROVE'];
    if (!validDecisions.includes(body.decision)) {
      return reply.code(400).send({ error: `decision must be one of: ${validDecisions.join(', ')}` });
    }

    try {
      // Auto-assign priority: max existing + 10
      const maxRule = await prisma.policyRule.findFirst({
        orderBy: { priority: 'desc' },
        select: { priority: true },
      });
      const priority = (maxRule?.priority ?? 0) + 10;

      const rule = await prisma.policyRule.create({
        data: {
          priority,
          matchTool: body.matchTool,
          riskTier: body.riskTier,
          decision: body.decision,
          matchArgs: body.matchArgs ?? null,
          matchCategory: body.matchCategory ?? null,
          constraints: body.constraints ?? null,
          source: body.source ?? 'manual',
          description: body.description ?? null,
          enabled: body.enabled ?? true,
        },
      });

      return reply.code(201).send(rule);
    } catch (err) {
      request.log.error(err, 'Failed to create policy rule');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/policies/:id — Update a policy rule.
   */
  app.patch('/api/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      matchTool?: string;
      riskTier?: string;
      decision?: string;
      matchArgs?: string | null;
      constraints?: string | null;
      enabled?: boolean;
    };

    if (body.decision) {
      const validDecisions = ['ALLOW', 'DENY', 'APPROVE'];
      if (!validDecisions.includes(body.decision)) {
        return reply.code(400).send({ error: `decision must be one of: ${validDecisions.join(', ')}` });
      }
    }

    try {
      const rule = await prisma.policyRule.update({
        where: { id },
        data: {
          ...(body.matchTool !== undefined && { matchTool: body.matchTool }),
          ...(body.riskTier !== undefined && { riskTier: body.riskTier }),
          ...(body.decision !== undefined && { decision: body.decision }),
          ...(body.matchArgs !== undefined && { matchArgs: body.matchArgs }),
          ...(body.constraints !== undefined && { constraints: body.constraints }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      });

      return reply.send(rule);
    } catch (err) {
      request.log.error(err, 'Failed to update policy rule');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/policies/:id — Delete a policy rule.
   */
  app.delete('/api/policies/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.policyRule.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete policy rule');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/policies/presets/:name — Replace all rules with a preset.
   *
   * Deletes all existing rules and creates the preset's rules.
   */
  app.post('/api/policies/presets/:name', async (request: FastifyRequest, reply: FastifyReply) => {
    const { name } = request.params as { name: string };
    const preset = ALL_PRESETS[name];

    if (!preset) {
      const available = Object.keys(ALL_PRESETS).join(', ');
      return reply.code(400).send({ error: `Unknown preset "${name}". Available: ${available}` });
    }

    try {
      await prisma.$transaction([
        prisma.policyRule.deleteMany(),
        ...preset.rules.map((rule) =>
          prisma.policyRule.create({ data: rule }),
        ),
      ]);

      const rules = await prisma.policyRule.findMany({
        orderBy: { priority: 'asc' },
      });

      return reply.send({
        preset: preset.name,
        description: preset.description,
        rules,
      });
    } catch (err) {
      request.log.error(err, 'Failed to apply preset');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/policies/presets — List available presets.
   */
  app.get('/api/policies/presets', async (_request: FastifyRequest, reply: FastifyReply) => {
    const presets = Object.entries(ALL_PRESETS).map(([key, preset]) => ({
      id: key,
      name: preset.name,
      description: preset.description,
      ruleCount: preset.rules.length,
    }));
    return reply.send(presets);
  });

  /**
   * POST /api/policies/ai-optimize — AI analyzes patterns and suggests/applies policy changes.
   *
   * Body: { autoApply?: boolean }
   */
  app.post('/api/policies/ai-optimize', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isAIEnabled()) {
      return reply.code(400).send({ error: 'AI supervisor not configured. Set OPENAI_API_KEY.' });
    }

    const body = request.body as { autoApply?: boolean } | null;
    const autoApply = body?.autoApply ?? false;

    try {
      // Gather context: recent tool calls with categories, approval history, current rules, agent role
      const recentCalls = await prisma.toolCall.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { approval: true, receipt: true },
      });

      const currentRules = await prisma.policyRule.findMany({
        where: { enabled: true },
        orderBy: { priority: 'asc' },
      });

      // Get instance role
      const instance = await prisma.instance.findFirst({ orderBy: { updatedAt: 'desc' } });
      const agentRole = instance?.role ?? instance?.inferredRole ?? 'unknown';

      // Summarize activity by category
      const categoryStats: Record<string, { total: number; approved: number; denied: number; autoAllowed: number }> = {};
      for (const tc of recentCalls) {
        const cat = (tc as any).category ?? 'other';
        if (!categoryStats[cat]) categoryStats[cat] = { total: 0, approved: 0, denied: 0, autoAllowed: 0 };
        categoryStats[cat].total++;
        if (tc.approval?.status === 'APPROVED') categoryStats[cat].approved++;
        else if (tc.approval?.status === 'DENIED' || tc.receipt?.policyDecision === 'DENY') categoryStats[cat].denied++;
        else if (tc.receipt?.policyDecision === 'ALLOW') categoryStats[cat].autoAllowed++;
      }

      const activitySummary = Object.entries(categoryStats)
        .map(([cat, s]) => `- ${cat}: ${s.total} total (${s.autoAllowed} auto-allowed, ${s.approved} human-approved, ${s.denied} denied)`)
        .join('\n');

      const currentRulesSummary = currentRules
        .map(r => `- #${r.priority}: ${r.matchTool} [${r.riskTier}] ${r.matchCategory ? `(${r.matchCategory})` : ''} → ${r.decision} (source: ${r.source})`)
        .join('\n');

      const ai = new OpenAI({ apiKey: config.OPENAI_API_KEY });
      const response = await ai.chat.completions.create({
        model: config.OPENAI_MODEL,
        temperature: 0.2,
        max_tokens: 1000,
        messages: [
          {
            role: 'system',
            content: `You are a policy optimizer for an AI agent supervision system. Analyze the agent's activity patterns and suggest policy rule changes.

The agent's role is: "${agentRole}"

Categories: code, git, packages, shell, files, network, secrets, infra, communication, destructive, data, other
Decisions: ALLOW (auto-proceed), APPROVE (human review), DENY (block)

Suggest rules that:
- Auto-allow categories with high approval rates and zero denials (if the agent's role fits)
- Require approval for categories with mixed history
- Block categories that are outside the agent's role or have been frequently denied

Respond in JSON ONLY:
{
  "suggestions": [
    {
      "action": "add|remove|update",
      "matchCategory": "category_name",
      "matchTool": "*",
      "riskTier": "*",
      "decision": "ALLOW|APPROVE|DENY",
      "description": "Human-readable explanation",
      "reasoning": "Why this change makes sense"
    }
  ],
  "summary": "One sentence overview of changes"
}`,
          },
          {
            role: 'user',
            content: `ACTIVITY BY CATEGORY (last 100 actions):
${activitySummary || '(no activity yet)'}

CURRENT RULES:
${currentRulesSummary || '(no rules)'}

Agent role: ${agentRole}

Suggest policy optimizations.`,
          },
        ],
      });

      const text = response.choices[0]?.message?.content ?? '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return reply.code(500).send({ error: 'AI returned invalid response' });
      }

      const result = JSON.parse(jsonMatch[0]) as {
        suggestions: Array<{
          action: string;
          matchCategory: string;
          matchTool: string;
          riskTier: string;
          decision: string;
          description: string;
          reasoning: string;
        }>;
        summary: string;
      };

      // Auto-apply if requested
      if (autoApply && result.suggestions.length > 0) {
        for (const suggestion of result.suggestions) {
          if (suggestion.action === 'add') {
            const maxRule = await prisma.policyRule.findFirst({
              orderBy: { priority: 'desc' },
              select: { priority: true },
            });
            await prisma.policyRule.create({
              data: {
                priority: (maxRule?.priority ?? 0) + 10,
                matchTool: suggestion.matchTool || '*',
                riskTier: suggestion.riskTier || '*',
                matchCategory: suggestion.matchCategory,
                decision: suggestion.decision,
                description: suggestion.description,
                source: 'ai-learned',
                enabled: true,
              },
            });
          }
        }
      }

      return reply.send({
        suggestions: result.suggestions,
        summary: result.summary,
        applied: autoApply,
        agentRole,
      });
    } catch (err) {
      request.log.error(err, 'AI policy optimization failed');
      return reply.code(500).send({ error: 'AI analysis failed' });
    }
  });
}
