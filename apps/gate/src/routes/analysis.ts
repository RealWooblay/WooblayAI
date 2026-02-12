/**
 * Analysis + Identity routes.
 *
 * Provides endpoints for:
 *   - Task analysis retrieval
 *   - Agent insights (behavioral profile, trust trajectory, failure modes)
 *   - Agent lineage tree
 *   - Analysis recompute
 *   - Agent spawn
 *   - Trust overrides
 *   - Canary management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  SpawnAgentRequestSchema,
  TrustOverrideRequestSchema,
  CreateCanaryRequestSchema,
} from '@wooblay/schemas';
import type { Finding, Severity, AgentProfile, AgentBaseline, TrustLevel } from '@wooblay/types';
import { prisma } from '../db/client.js';
import { validateBody } from '../middleware/validate.js';
import { analyzeTask, recomputeAnalysis } from '../engine/analyzer/index.js';
import { registerSpawn, buildLineageTree, trustLevelFromScore } from '../engine/identity/lineage.js';
import { persistEvent } from '../events/bus.js';

export async function analysisRoutes(app: FastifyInstance): Promise<void> {
  // ── Task Analysis ─────────────────────────────────────────────────────────

  /**
   * GET /api/tasks/:id/analysis — All analyses for a task.
   */
  app.get('/api/tasks/:id/analysis', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const analyses = await prisma.analysis.findMany({
        where: { taskId: id },
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
      });

      const parsed = analyses.map(parseAnalysisRecord);

      // Sort by severity order
      const sevOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
      parsed.sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity));

      return reply.send(parsed);
    } catch (err) {
      request.log.error(err, 'Failed to fetch task analysis');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Agent Insights ────────────────────────────────────────────────────────

  /**
   * GET /api/agents/:pubkey/insights — Aggregate agent intelligence.
   */
  app.get('/api/agents/:pubkey/insights', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pubkey } = request.params as { pubkey: string };

    try {
      const agent = await prisma.agent.findUnique({ where: { pubkey } });
      if (!agent) return reply.code(404).send({ error: 'Agent not found' });

      // Parse profile and baseline
      let profile: AgentProfile | null = null;
      let baseline: AgentBaseline | null = null;
      try { if (agent.profileJson) profile = JSON.parse(agent.profileJson); } catch {}
      try { if (agent.baselineJson) baseline = JSON.parse(agent.baselineJson); } catch {}

      // Get all analyses for this agent
      const analyses = await prisma.analysis.findMany({
        where: { agentPubkey: pubkey },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      // Top failure modes
      const findingCounts = new Map<string, { count: number; lastSeen: string }>();
      for (const a of analyses) {
        const findings: Finding[] = JSON.parse(a.findings);
        for (const f of findings) {
          const existing = findingCounts.get(f.code) ?? { count: 0, lastSeen: a.createdAt.toISOString() };
          existing.count++;
          if (a.createdAt.toISOString() > existing.lastSeen) existing.lastSeen = a.createdAt.toISOString();
          findingCounts.set(f.code, existing);
        }
      }

      const topFailureModes = [...findingCounts.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5)
        .map(([code, { count, lastSeen }]) => ({ code, count, lastSeen }));

      // Common denies
      const deniedCalls = await prisma.toolCall.findMany({
        where: { agentPubkey: pubkey },
        include: { receipt: { select: { policyDecision: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });

      const denyCounts = new Map<string, number>();
      for (const tc of deniedCalls) {
        if (tc.receipt?.policyDecision === 'DENY') {
          const key = `${tc.toolName}::${tc.args.slice(0, 50)}`;
          denyCounts.set(key, (denyCounts.get(key) ?? 0) + 1);
        }
      }

      const commonDenies = [...denyCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([key, count]) => {
          const [toolName, argSignature] = key.split('::');
          return { toolName, argSignature: argSignature ?? '', count };
        });

      // Reliability
      const scores = await prisma.score.findMany({
        where: { agentPubkey: pubkey },
        select: { label: true, taskId: true },
      });

      const totalTasks = scores.length;
      const successCount = scores.filter((s) => s.label === 'SUCCESS').length;
      const successRate = totalTasks > 0 ? successCount / totalTasks : 0;
      const totalFindings = analyses.reduce((acc, a) => {
        const findings: Finding[] = JSON.parse(a.findings);
        return acc + findings.length;
      }, 0);

      // Lineage
      const parent = agent.parentPubkey
        ? await prisma.agent.findUnique({ where: { pubkey: agent.parentPubkey }, select: { pubkey: true, name: true, trustScore: true } })
        : null;

      const children = await prisma.agent.findMany({
        where: { parentPubkey: pubkey },
        select: { pubkey: true, name: true, trustScore: true, spawnDepth: true },
      });

      // Count total descendants
      const allDescendants = await prisma.agent.count({
        where: { parentPubkey: pubkey },
      });

      // Severity trend (last 7 days)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentAnalyses = analyses.filter((a) => a.createdAt >= sevenDaysAgo);

      const severityBuckets = new Map<string, { critical: number; high: number; medium: number; low: number; info: number }>();
      for (const a of recentAnalyses) {
        const date = a.createdAt.toISOString().slice(0, 10);
        if (!severityBuckets.has(date)) {
          severityBuckets.set(date, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
        }
        const bucket = severityBuckets.get(date)!;
        const sev = a.severity.toLowerCase() as keyof typeof bucket;
        if (sev in bucket) bucket[sev]++;
      }

      const recentSeverityTrend = [...severityBuckets.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, counts]) => ({ date, ...counts }));

      return reply.send({
        profile,
        trustTrajectory: baseline?.trustHistory ?? [],
        topFailureModes,
        commonDenies,
        reliability: {
          successRate,
          avgFindingsPerTask: totalTasks > 0 ? totalFindings / totalTasks : 0,
          totalTasks,
        },
        lineage: {
          parent,
          children,
        },
        recentSeverityTrend,
        spawnCount: {
          direct: children.length,
          total: allDescendants,
        },
        totalAnalyses: analyses.length,
        criticalCount: analyses.filter((a) => a.severity === 'CRITICAL').length,
        highCount: analyses.filter((a) => a.severity === 'HIGH').length,
      });
    } catch (err) {
      request.log.error(err, 'Failed to fetch agent insights');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Agent Lineage Tree ────────────────────────────────────────────────────

  /**
   * GET /api/agents/:pubkey/lineage — Full lineage tree.
   */
  app.get('/api/agents/:pubkey/lineage', async (request: FastifyRequest, reply: FastifyReply) => {
    const { pubkey } = request.params as { pubkey: string };

    try {
      const tree = await buildLineageTree(prisma, pubkey);
      if (!tree) return reply.code(404).send({ error: 'Agent not found' });
      return reply.send(tree);
    } catch (err) {
      request.log.error(err, 'Failed to build lineage tree');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Analysis Recompute ────────────────────────────────────────────────────

  /**
   * POST /api/analysis/recompute?taskId=... — Re-run full pipeline for a task.
   */
  app.post('/api/analysis/recompute', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { taskId?: string };
    if (!query.taskId) {
      return reply.code(400).send({ error: 'taskId query parameter required' });
    }

    try {
      const results = await recomputeAnalysis(prisma, query.taskId);
      return reply.send({
        taskId: query.taskId,
        analysesCreated: results.length,
        results,
      });
    } catch (err) {
      request.log.error(err, 'Analysis recompute failed');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  // ── Agent Spawn ───────────────────────────────────────────────────────────

  /**
   * POST /api/agents/spawn — Register a child agent with spawn attestation.
   */
  app.post(
    '/api/agents/spawn',
    { preHandler: validateBody(SpawnAgentRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        spawnerPubkey: string;
        spawnedPubkey: string;
        spawnedName: string;
        purpose: string;
        scope?: {
          allowedTools: string[];
          allowedDomains: string[];
          riskCeiling: string;
          maxDuration?: number;
          maxToolCalls?: number;
        };
        signature: string;
      };

      try {
        const result = await registerSpawn(prisma, body);

        // Emit spawn event
        await persistEvent(prisma, {
          type: 'agent.spawned',
          data: {
            spawnerPubkey: body.spawnerPubkey,
            spawnedPubkey: body.spawnedPubkey,
            attestationId: result.attestationId,
          },
        });

        return reply.code(201).send({
          agentId: result.agentId,
          attestationId: result.attestationId,
          trustScore: result.trustScore,
          trustLevel: result.trustLevel,
        });
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          return reply.code(404).send({ error: err.message });
        }
        request.log.error(err, 'Failed to register spawn');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  // ── Trust Override ────────────────────────────────────────────────────────

  /**
   * POST /api/agents/:pubkey/trust/override — Manual trust level override.
   */
  app.post(
    '/api/agents/:pubkey/trust/override',
    { preHandler: validateBody(TrustOverrideRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { pubkey } = request.params as { pubkey: string };
      const body = request.body as { trustLevel: TrustLevel; reason: string; operator: string };

      try {
        const agent = await prisma.agent.findUnique({ where: { pubkey } });
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });

        const oldLevel = agent.trustLevel as TrustLevel;
        const newScore = body.trustLevel === 'autonomous' ? 85 : body.trustLevel === 'write-with-approvals' ? 55 : 20;

        await prisma.agent.update({
          where: { pubkey },
          data: { trustLevel: body.trustLevel, trustScore: newScore },
        });

        // Log the override
        await persistEvent(prisma, {
          type: 'agent.trust.changed',
          data: {
            agentPubkey: pubkey,
            from: oldLevel,
            to: body.trustLevel,
            trigger: `manual_override:${body.operator}:${body.reason}`,
          },
        });

        return reply.send({ pubkey, trustLevel: body.trustLevel, trustScore: newScore });
      } catch (err) {
        request.log.error(err, 'Failed to override trust');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  // ── Canary CRUD ───────────────────────────────────────────────────────────

  /**
   * GET /api/canaries — List all canaries.
   */
  app.get('/api/canaries', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const canaries = await prisma.canary.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(canaries);
    } catch (err) {
      _request.log.error(err, 'Failed to list canaries');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/canaries — Create a canary.
   */
  app.post(
    '/api/canaries',
    { preHandler: validateBody(CreateCanaryRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as { type: string; value: string; description: string };

      try {
        const canary = await prisma.canary.create({
          data: {
            type: body.type,
            value: body.value,
            description: body.description,
          },
        });
        return reply.code(201).send(canary);
      } catch (err) {
        request.log.error(err, 'Failed to create canary');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * DELETE /api/canaries/:id — Delete a canary.
   */
  app.delete('/api/canaries/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      await prisma.canary.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete canary');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseAnalysisRecord(record: {
  id: string;
  taskId: string | null;
  receiptId: string | null;
  agentPubkey: string;
  severity: string;
  tags: string;
  summary: string;
  findings: string;
  causalChain: string | null;
  briefMarkdown: string | null;
  createdAt: Date;
}) {
  return {
    id: record.id,
    taskId: record.taskId,
    receiptId: record.receiptId,
    agentPubkey: record.agentPubkey,
    severity: record.severity,
    tags: JSON.parse(record.tags),
    summary: record.summary,
    findings: JSON.parse(record.findings),
    causalChain: record.causalChain ? JSON.parse(record.causalChain) : null,
    briefMarkdown: record.briefMarkdown,
    createdAt: record.createdAt.toISOString(),
  };
}
