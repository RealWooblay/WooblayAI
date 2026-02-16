/**
 * Proposal routes.
 *
 * Proposals are the unit of work in a run. Each proposal is an action
 * the agent wants to take, with evidence, risk classification, and
 * an approval flow.
 */

import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { persistEvent } from '../events/bus.js';
import {
  createEvidenceBundle,
  runCIReplayRecipe,
  createManualEvidence,
  hashValue,
} from '../engine/evidence.js';

export async function proposalRoutes(app: FastifyInstance): Promise<void> {
  // ── List proposals ────────────────────────────────────────────────────
  app.get('/api/proposals', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { runId?: string; status?: string; limit?: string };
    const where: Record<string, unknown> = {};
    if (query.runId) where.runId = query.runId;
    if (query.status) where.status = query.status;

    const proposals = await prisma.proposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(query.limit) || 50, 100),
      include: { evidenceBundle: true },
    });

    return reply.send(proposals);
  });

  // ── Get single proposal ───────────────────────────────────────────────
  app.get('/api/proposals/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { evidenceBundle: true, run: { include: { operation: true } } },
    });
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
    return reply.send(proposal);
  });

  // ── Create a proposal ─────────────────────────────────────────────────
  app.post('/api/proposals', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      runId: string;
      actionClass: string;
      toolName: string;
      args: Record<string, unknown>;
      riskClass?: string;
      irreversible?: boolean;
      compensatingAction?: string;
    };

    if (!body.runId || !body.actionClass || !body.toolName) {
      return reply.code(400).send({ error: 'runId, actionClass, and toolName are required' });
    }

    // Verify run exists and is active
    const run = await prisma.run.findUnique({ where: { id: body.runId } });
    if (!run) return reply.code(404).send({ error: 'Run not found' });
    if (!['running', 'scheduled'].includes(run.status)) {
      return reply.code(400).send({ error: `Run is in status ${run.status}, cannot create proposals` });
    }

    // Hash the args for tamper evidence (don't store raw args for high-risk)
    const argsJson = JSON.stringify(body.args);
    const argsHash = hashValue(argsJson);
    const riskClass = body.riskClass ?? 'medium';
    const storeRawArgs = riskClass === 'low' || riskClass === 'medium';

    const proposal = await prisma.proposal.create({
      data: {
        runId: body.runId,
        actionClass: body.actionClass,
        toolName: body.toolName,
        argsHash,
        rawArgs: storeRawArgs ? argsJson : null,
        riskClass,
        irreversible: body.irreversible ?? false,
        compensatingAction: body.compensatingAction ?? null,
      },
    });

    await persistEvent(prisma, {
      type: 'proposal.created',
      data: {
        proposalId: proposal.id,
        runId: body.runId,
        actionClass: body.actionClass,
        riskClass,
      },
    });

    return reply.code(201).send(proposal);
  });

  // ── Attach evidence to a proposal ─────────────────────────────────────
  app.post('/api/proposals/:id/evidence', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      recipeType: string;
      // For CI replay
      repoUrl?: string;
      baseCommit?: string;
      headCommit?: string;
      testCommand?: string;
      setupCommand?: string;
      // For manual
      structuredDiff?: string;
    };

    const proposal = await prisma.proposal.findUnique({
      where: { id },
      include: { run: true },
    });
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });

    if (body.recipeType === 'ci_replay') {
      if (!body.repoUrl || !body.baseCommit || !body.headCommit || !body.testCommand) {
        return reply.code(400).send({
          error: 'repoUrl, baseCommit, headCommit, and testCommand are required for ci_replay',
        });
      }

      const bundleId = await createEvidenceBundle(prisma, proposal.runId, 'ci_replay');

      // Link to proposal
      await prisma.proposal.update({
        where: { id },
        data: { evidenceBundleId: bundleId },
      });

      // Run async (non-blocking)
      runCIReplayRecipe(prisma, bundleId, {
        runId: proposal.runId,
        repoUrl: body.repoUrl,
        baseCommit: body.baseCommit,
        headCommit: body.headCommit,
        testCommand: body.testCommand,
        setupCommand: body.setupCommand,
      }).catch((err) => {
        console.error(`[evidence] CI replay failed for bundle ${bundleId}:`, err);
      });

      return reply.code(202).send({ evidenceBundleId: bundleId, status: 'running' });
    }

    if (body.recipeType === 'manual') {
      const bundleId = await createManualEvidence(prisma, proposal.runId, {
        structuredDiff: body.structuredDiff,
      });

      await prisma.proposal.update({
        where: { id },
        data: { evidenceBundleId: bundleId },
      });

      return reply.code(201).send({ evidenceBundleId: bundleId, status: 'completed' });
    }

    return reply.code(400).send({ error: `Unknown recipe type: ${body.recipeType}` });
  });

  // ── Approve a proposal ────────────────────────────────────────────────
  app.post('/api/proposals/:id/approve', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { approver?: string };

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
    if (proposal.status !== 'pending') {
      return reply.code(400).send({ error: `Proposal is ${proposal.status}, not pending` });
    }

    const updated = await prisma.proposal.update({
      where: { id },
      data: {
        status: 'approved',
        approver: body?.approver ?? 'system',
        approvedAt: new Date(),
      },
    });

    await persistEvent(prisma, {
      type: 'proposal.decided',
      data: { proposalId: id, status: 'approved', approver: updated.approver ?? undefined },
    });

    return reply.send(updated);
  });

  // ── Deny a proposal ──────────────────────────────────────────────────
  app.post('/api/proposals/:id/deny', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { approver?: string };

    const proposal = await prisma.proposal.findUnique({ where: { id } });
    if (!proposal) return reply.code(404).send({ error: 'Proposal not found' });
    if (proposal.status !== 'pending') {
      return reply.code(400).send({ error: `Proposal is ${proposal.status}, not pending` });
    }

    const updated = await prisma.proposal.update({
      where: { id },
      data: { status: 'denied', approver: body?.approver ?? 'system' },
    });

    await persistEvent(prisma, {
      type: 'proposal.decided',
      data: { proposalId: id, status: 'denied', approver: updated.approver ?? undefined },
    });

    return reply.send(updated);
  });

  // ── Mark proposal as executed ─────────────────────────────────────────
  app.post('/api/proposals/:id/executed', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { toolCallId?: string };

    const updated = await prisma.proposal.update({
      where: { id },
      data: { status: 'executed', toolCallId: body?.toolCallId ?? null },
    });

    return reply.send(updated);
  });

  // ── Mark proposal as verified ─────────────────────────────────────────
  app.post('/api/proposals/:id/verified', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const updated = await prisma.proposal.update({
      where: { id },
      data: { status: 'verified' },
    });

    return reply.send(updated);
  });

  // ── Get evidence bundle for a proposal ────────────────────────────────
  app.get('/api/evidence/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const bundle = await prisma.evidenceBundle.findUnique({ where: { id } });
    if (!bundle) return reply.code(404).send({ error: 'Evidence bundle not found' });

    return reply.send({
      ...bundle,
      structuredDiff: bundle.structuredDiff ? JSON.parse(bundle.structuredDiff) : null,
      failingTests: bundle.failingTests ? JSON.parse(bundle.failingTests) : null,
      logArtifacts: bundle.logArtifacts ? JSON.parse(bundle.logArtifacts) : null,
    });
  });
}
