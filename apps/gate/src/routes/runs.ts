/**
 * Run routes.
 *
 * Lifecycle management for runs: create, schedule, pause, resume, kill, query.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import {
  createRun,
  transitionRun,
  quarantineRun,
  killRun,
  getSchedulableRuns,
  preemptForPriority,
  detectLoop,
  checkTimeouts,
} from '../engine/orchestrator.js';
import { checkBudget, getBudgetSummary } from '../engine/budget.js';
import { getOrgScope, assertOrgAccess, withOrg } from '../middleware/org-scope.js';
import type { RunStatus } from '@wooblay/types';

export async function runRoutes(app: FastifyInstance): Promise<void> {
  // ── List runs ─────────────────────────────────────────────────────────
  app.get('/api/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const query = request.query as {
      incidentId?: string;
      status?: string;
      limit?: string;
      offset?: string;
    };

    const where: Record<string, unknown> = { ...org.filter };
    if (query.incidentId) where.incidentId = query.incidentId;
    if (query.status) where.status = query.status;

    const [runs, total] = await Promise.all([
      prisma.run.findMany({
        where,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        take: Math.min(Number(query.limit) || 50, 100),
        skip: Number(query.offset) || 0,
        include: {
          incident: true,
          proposals: { orderBy: { createdAt: 'desc' }, take: 5 },
          _count: { select: { proposals: true, evidenceBundles: true, runEvents: true } },
        },
      }),
      prisma.run.count({ where }),
    ]);

    return reply.send({ runs, total });
  });

  // ── Get single run with full timeline ─────────────────────────────────
  app.get('/api/runs/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const { id } = request.params as { id: string };

    const run = await prisma.run.findUnique({
      where: { id },
      include: {
        incident: true,
        proposals: {
          orderBy: { createdAt: 'desc' },
          include: { evidenceBundle: true },
        },
        evidenceBundles: { orderBy: { createdAt: 'desc' } },
        runEvents: { orderBy: { sequenceNum: 'asc' } },
        capabilities: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!run) {
      return reply.code(404).send({ error: 'Run not found' });
    }

    assertOrgAccess(org, run, 'Run');

    return reply.send(run);
  });

  // ── Create a run for an incident ──────────────────────────────────────
  app.post('/api/runs', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      incidentId: string;
      priority?: string;
      workspaceId?: string;
      recipe?: string;
      budgetCents?: number;
    };

    if (!body.incidentId) {
      return reply.code(400).send({ error: 'incidentId is required' });
    }

    // Verify incident exists
    const incident = await prisma.incident.findUnique({
      where: { id: body.incidentId },
    });
    if (!incident) {
      return reply.code(404).send({ error: 'Incident not found' });
    }

    // Loop detection
    const isLoop = await detectLoop(prisma, body.incidentId);
    if (isLoop) {
      return reply.code(429).send({
        error: 'Loop detected: too many runs for this incident in the last 5 minutes',
        incidentId: body.incidentId,
      });
    }

    const run = await createRun(prisma, {
      incidentId: body.incidentId,
      priority: body.priority ?? incident.priority,
      workspaceId: body.workspaceId,
      recipe: body.recipe,
      budgetCents: body.budgetCents,
    });

    return reply.code(201).send(run);
  });

  // ── Schedule pending runs ─────────────────────────────────────────────
  app.post('/api/runs/schedule', async (_request: FastifyRequest, reply: FastifyReply) => {
    // Check timeouts first
    const timedOut = await checkTimeouts(prisma);

    // Get schedulable runs
    const schedulable = await getSchedulableRuns(prisma);

    const scheduled = [];
    for (const run of schedulable) {
      // Preempt if needed
      if (run.priority === 'P0') {
        await preemptForPriority(prisma, 'P0', run.workspaceId ?? undefined);
      }

      const updated = await transitionRun(prisma, run.id, 'scheduled');
      scheduled.push(updated);
    }

    return reply.send({
      scheduled: scheduled.length,
      timedOut: timedOut.length,
      runs: scheduled,
    });
  });

  // ── Transition a run to a new state ───────────────────────────────────
  app.post('/api/runs/:id/transition', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { status: RunStatus; reason?: string };

    if (!body.status) {
      return reply.code(400).send({ error: 'status is required' });
    }

    try {
      const run = await transitionRun(prisma, id, body.status, body.reason);
      return reply.send(run);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Pause a run ───────────────────────────────────────────────────────
  app.post('/api/runs/:id/pause', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };

    try {
      const run = await transitionRun(prisma, id, 'paused', body?.reason ?? 'Manual pause');
      return reply.send(run);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Resume a run ──────────────────────────────────────────────────────
  app.post('/api/runs/:id/resume', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const run = await transitionRun(prisma, id, 'running', 'Resumed');
      return reply.send(run);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Quarantine a run ──────────────────────────────────────────────────
  app.post('/api/runs/:id/quarantine', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason: string };

    if (!body?.reason) {
      return reply.code(400).send({ error: 'reason is required' });
    }

    try {
      const run = await quarantineRun(prisma, id, body.reason);
      return reply.send(run);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Kill a run ────────────────────────────────────────────────────────
  app.post('/api/runs/:id/kill', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { reason?: string };

    try {
      const run = await killRun(prisma, id, body?.reason ?? 'Kill switch activated');
      return reply.send(run);
    } catch (err: any) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // ── Check budget ──────────────────────────────────────────────────────
  app.get('/api/runs/:id/budget', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const budget = await checkBudget(prisma, id);
    return reply.send(budget);
  });

  // ── Get run timeline (events) ─────────────────────────────────────────
  //
  // Raw data is returned here. Secrets are already scrubbed at write time
  // (gateway applies redactSecrets before persisting to RunEvent). Additional
  // PII/display redaction happens at the UI presentation boundary only,
  // so that evidence verification and observedOutcome diffs can still
  // compare raw stored data without redaction artifacts.
  app.get('/api/runs/:id/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const events = await prisma.runEvent.findMany({
      where: { runId: id },
      orderBy: { sequenceNum: 'asc' },
    });

    return reply.send(events);
  });

  // ── Global budget summary ─────────────────────────────────────────────
  app.get('/api/budget', async (_request: FastifyRequest, reply: FastifyReply) => {
    const summary = await getBudgetSummary(prisma);
    return reply.send(summary);
  });

  // ── Cost breakdown for a run ──────────────────────────────────────────
  app.get('/api/runs/:id/costs', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { getRunCostSummary } = await import('../engine/cost-attribution.js');
    const summary = await getRunCostSummary(prisma, id);
    return reply.send(summary);
  });

  // ── Re-run evidence bundle (reproduce exact same evidence) ──────────
  app.post('/api/evidence/:id/rerun', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id: bundleId } = request.params as { id: string };

    const bundle = await prisma.evidenceBundle.findUnique({
      where: { id: bundleId },
      include: { run: { include: { incident: true } } },
    });

    if (!bundle) {
      return reply.code(404).send({ error: 'Evidence bundle not found' });
    }

    const org = getOrgScope(request);
    assertOrgAccess(org, bundle.run, 'Run');

    if (bundle.status !== 'completed') {
      return reply.code(400).send({ error: `Cannot rerun evidence in status: ${bundle.status}` });
    }

    // Parse the original structured diff to get recipe inputs
    const diff = bundle.structuredDiff ? JSON.parse(bundle.structuredDiff) : null;
    if (!diff?.baseCommit || !diff?.headCommit) {
      return reply.code(400).send({ error: 'Original evidence bundle lacks commit data for rerun' });
    }

    // Load environment manifest if available
    const envRecord = await prisma.evidenceEnvironment.findFirst({
      where: { bundleId },
    });

    // Create new evidence bundle as a child of the same run
    const { createEvidenceBundle, runCIReplayRecipe } = await import('../engine/evidence.js');
    const newBundleId = await createEvidenceBundle(prisma, bundle.runId, `${bundle.recipeType}_rerun`);

    // Get repo URL from incident
    const repoFullName = bundle.run.incident.repoFullName;
    if (!repoFullName) {
      return reply.code(400).send({ error: 'No repo linked to incident' });
    }

    // Load repo config for test command
    const repoConfig = await prisma.repoConfig.findFirst({
      where: { repoFullName },
    });

    // Kick off the rerun asynchronously
    const repoUrl = `https://github.com/${repoFullName}.git`;
    runCIReplayRecipe(prisma, newBundleId, {
      runId: bundle.runId,
      repoUrl,
      baseCommit: diff.baseCommit,
      headCommit: diff.headCommit,
      testCommand: repoConfig?.testCmd ?? 'npm test',
      setupCommand: repoConfig?.installCmd ?? undefined,
    }).catch((err: any) => {
      request.log.error(err, 'Evidence rerun failed');
    });

    return reply.code(201).send({
      newBundleId,
      originalBundleId: bundleId,
      runId: bundle.runId,
      status: 'running',
      message: 'Evidence rerun started. Same commits, same recipe — compare results.',
      environmentManifest: envRecord ? {
        baseImageDigest: envRecord.baseImageDigest,
        osVersion: envRecord.osVersion,
        toolchainVersions: envRecord.toolchainVersions ? JSON.parse(envRecord.toolchainVersions) : null,
        dependencyHash: envRecord.dependencyHash,
      } : null,
    });
  });
}
