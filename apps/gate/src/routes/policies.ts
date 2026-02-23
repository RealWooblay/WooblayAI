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
import { buildPolicyOptimizerPrompt } from '../prompts/policy-optimizer.js';
import { resolveOrgIdForRequest } from '../middleware/org-resolve.js';

export async function policyRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/policies — List all policy rules ordered by priority.
   */
  app.get('/api/policies', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { instanceId } = _request.query as { instanceId?: string };
      const rules = await prisma.policyRule.findMany({
        where: { instanceId: instanceId ?? null },
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
      instanceId?: string;
    };

    if (!body.matchTool || !body.riskTier || !body.decision) {
      return reply.code(400).send({ error: 'matchTool, riskTier, and decision are required' });
    }

    const validDecisions = ['ALLOW', 'DENY', 'APPROVE'];
    if (!validDecisions.includes(body.decision)) {
      return reply.code(400).send({ error: `decision must be one of: ${validDecisions.join(', ')}` });
    }

    try {
      const targetInstanceId = body.instanceId ?? null;

      // Prevent exact duplicates (same tool + category + decision + riskTier for same instance)
      const existing = await prisma.policyRule.findFirst({
        where: {
          instanceId: targetInstanceId,
          matchTool: body.matchTool,
          matchCategory: body.matchCategory ?? null,
          decision: body.decision,
          riskTier: body.riskTier,
          enabled: true,
        },
      });
      if (existing) {
        return reply.code(409).send({
          error: 'Duplicate rule — a matching rule already exists',
          existingRuleId: existing.id,
        });
      }

      // Auto-assign priority: max existing for same instanceId + 10
      const maxRule = await prisma.policyRule.findFirst({
        where: { instanceId: targetInstanceId },
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
          instanceId: targetInstanceId,
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
      matchCategory?: string | null;
      constraints?: string | null;
      source?: string;
      description?: string | null;
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
          ...(body.matchCategory !== undefined && { matchCategory: body.matchCategory }),
          ...(body.constraints !== undefined && { constraints: body.constraints }),
          ...(body.source !== undefined && { source: body.source }),
          ...(body.description !== undefined && { description: body.description }),
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
    const { instanceId } = request.query as { instanceId?: string };
    const targetInstanceId = instanceId ?? null;
    const preset = ALL_PRESETS[name];

    if (!preset) {
      const available = Object.keys(ALL_PRESETS).join(', ');
      return reply.code(400).send({ error: `Unknown preset "${name}". Available: ${available}` });
    }

    try {
      await prisma.$transaction([
        prisma.policyRule.deleteMany({ where: { instanceId: targetInstanceId } }),
        ...preset.rules.map((rule) =>
          prisma.policyRule.create({ data: { ...rule, instanceId: targetInstanceId } }),
        ),
      ]);

      const rules = await prisma.policyRule.findMany({
        where: { instanceId: targetInstanceId },
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

    const body = request.body as { autoApply?: boolean; instanceId?: string; prompt?: string } | null;
    const autoApply = body?.autoApply ?? false;
    const targetInstanceId = body?.instanceId ?? null;
    const userPrompt = body?.prompt ?? null;

    try {
      // Gather context: recent tool calls with categories, approval history, current rules, agent role
      // MVP: use most recent agent's tool calls (in production, filter by instance→agent mapping)
      const recentCalls = await prisma.toolCall.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        include: { approval: true, receipt: true },
      });

      const currentRules = await prisma.policyRule.findMany({
        where: { enabled: true, instanceId: targetInstanceId },
        orderBy: { priority: 'asc' },
      });

      // Get instance role
      const instance = targetInstanceId
        ? await prisma.instance.findUnique({ where: { id: targetInstanceId } })
        : await prisma.instance.findFirst({ orderBy: { updatedAt: 'desc' } });
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
        max_tokens: 2500,
        messages: [
          {
            role: 'system',
            content: buildPolicyOptimizerPrompt(agentRole),
          },
          {
            role: 'user',
            content: userPrompt
              ? `USER REQUEST: "${userPrompt}"

Create policy rules that implement the user's request. Be precise — generate the exact rules needed.

CURRENT RULES:
${currentRulesSummary || '(no rules)'}

Agent role: ${agentRole}

Generate rules from the user's prompt.`
              : `ACTIVITY BY CATEGORY (last 100 actions):
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

      let result: {
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

      try {
        result = JSON.parse(jsonMatch[0]);
      } catch {
        // LLM response was likely truncated by max_tokens — attempt repair
        let repaired = jsonMatch[0];
        // Close any open strings
        const quoteCount = (repaired.match(/"/g) || []).length;
        if (quoteCount % 2 !== 0) repaired += '"';
        // Close any open arrays/objects
        const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/\]/g) || []).length;
        const openBraces = (repaired.match(/\{/g) || []).length - (repaired.match(/\}/g) || []).length;
        // Remove trailing comma before closing
        repaired = repaired.replace(/,\s*$/, '');
        for (let i = 0; i < openBrackets; i++) repaired += ']';
        for (let i = 0; i < openBraces; i++) repaired += '}';
        try {
          result = JSON.parse(repaired);
        } catch (e2: any) {
          return reply.code(500).send({
            error: 'AI returned malformed JSON',
            detail: `Parse failed after repair attempt: ${e2.message}`,
          });
        }
      }

      // Auto-apply if requested
      if (autoApply && result.suggestions.length > 0) {
        for (const suggestion of result.suggestions) {
          if (suggestion.action === 'add') {
            const maxRule = await prisma.policyRule.findFirst({
              where: { instanceId: targetInstanceId },
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
                instanceId: targetInstanceId,
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
    } catch (err: any) {
      request.log.error(err, 'AI policy optimization failed');
      const detail = err?.message ?? String(err);
      const status = err?.status ?? 500;
      return reply.code(status === 401 || status === 429 ? status : 500).send({
        error: 'AI analysis failed',
        detail,
      });
    }
  });

  // ── Org Settings (simulation threshold, etc.) ───────────────────────────

  /**
   * GET /api/policies/settings — Get org-level policy settings.
   */
  app.get('/api/policies/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = await resolveOrgIdForRequest(prisma, request);
      if (!orgId) {
        return reply.send({ simulationThreshold: 'high', platformMode: 'firewall' });
      }

      const orgRecord = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { settings: true },
      });

      const settings = orgRecord?.settings ? JSON.parse(orgRecord.settings) : {};
      return reply.send({
        simulationThreshold: settings.simulationThreshold ?? 'high',
        platformMode: settings.platformMode ?? 'firewall',
      });
    } catch (err) {
      request.log.error(err, 'Failed to get org settings');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PUT /api/policies/settings — Update org-level policy settings.
   */
  app.put('/api/policies/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const orgId = await resolveOrgIdForRequest(prisma, request);
      if (!orgId) {
        return reply.code(400).send({ error: 'No organization found. Create one in your account settings.' });
      }

      const body = request.body as {
        simulationThreshold?: string;
        platformMode?: string;
        unlockPassword?: string;
      };
      const validThresholds = ['critical_only', 'high', 'medium', 'all'];

      if (body.simulationThreshold && !validThresholds.includes(body.simulationThreshold)) {
        return reply.code(400).send({
          error: `Invalid simulationThreshold. Must be one of: ${validThresholds.join(', ')}`,
        });
      }

      if (body.platformMode && !['firewall', 'full'].includes(body.platformMode)) {
        return reply.code(400).send({ error: 'Invalid platformMode. Must be "firewall" or "full".' });
      }

      // Read existing settings and merge
      const orgRecord = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { settings: true },
      });

      const existing = orgRecord?.settings ? JSON.parse(orgRecord.settings) : {};
      const updated = { ...existing };
      if (body.simulationThreshold) updated.simulationThreshold = body.simulationThreshold;

      // Platform mode: Wooblay controls who gets Full Platform via env password (we give it to select customers)
      if (body.platformMode === 'full') {
        const unlockPassword = config.FULL_PLATFORM_UNLOCK_PASSWORD;
        if (!unlockPassword) {
          return reply.code(503).send({ error: 'Full Platform access is not configured. Contact Wooblay for access.' });
        }
        if (body.unlockPassword !== unlockPassword) {
          return reply.code(403).send({ error: 'Incorrect platform password.' });
        }
        updated.platformMode = 'full';
        delete updated.platformPassword;
      } else if (body.platformMode === 'firewall') {
        updated.platformMode = 'firewall';
      }

      await prisma.organization.update({
        where: { id: orgId },
        data: { settings: JSON.stringify(updated) },
      });

      return reply.send({
        simulationThreshold: updated.simulationThreshold ?? 'high',
        platformMode: updated.platformMode ?? 'firewall',
      });
    } catch (err) {
      request.log.error(err, 'Failed to update org settings');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
