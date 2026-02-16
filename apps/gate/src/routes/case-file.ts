/**
 * Case File Export routes.
 *
 * Exports a complete "case file" for a run: all receipts, evidence bundles,
 * proposals, and the full decision trail as a JSON bundle (ZIP in production).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { prisma } from '../db/client.js';

export async function caseFileRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/case-files/:runId
   *
   * Export complete case file for a run.
   */
  app.get('/api/case-files/:runId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };

    const run = await prisma.run.findUnique({
      where: { id: runId },
      include: {
        incident: true,
        proposals: {
          include: { evidenceBundle: true },
          orderBy: { createdAt: 'asc' },
        },
        evidenceBundles: { orderBy: { createdAt: 'asc' } },
        runEvents: { orderBy: { sequenceNum: 'asc' } },
        capabilities: { orderBy: { createdAt: 'asc' } },
        costs: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!run) {
      return reply.code(404).send({ error: 'Run not found' });
    }

    // Get all receipts linked to this run
    const receipts = await prisma.receipt.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });

    // Get all artifacts linked to this run
    const artifacts = await prisma.artifact.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });

    // Get all verifications linked to this run
    const verifications = await prisma.verification.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });

    // Get evidence environment manifests
    const evidenceEnvs = await prisma.evidenceEnvironment.findMany({
      where: {
        bundleId: { in: run.evidenceBundles.map((eb) => eb.id) },
      },
    });

    // Build the case file
    const caseFile = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      run: {
        id: run.id,
        incidentId: run.incidentId,
        status: run.status,
        priority: run.priority,
        attempt: run.attempt,
        recipe: run.recipe,
        budgetCents: run.budgetCents,
        spentCents: run.spentCents,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        createdAt: run.createdAt,
      },
      incident: run.incident,
      proposals: run.proposals.map((p) => ({
        id: p.id,
        actionClass: p.actionClass,
        toolName: p.toolName,
        argsHash: p.argsHash,
        riskClass: p.riskClass,
        irreversible: p.irreversible,
        compensatingAction: p.compensatingAction,
        status: p.status,
        approver: p.approver,
        approvedAt: p.approvedAt,
        createdAt: p.createdAt,
        evidence: p.evidenceBundle ? {
          id: p.evidenceBundle.id,
          recipeType: p.evidenceBundle.recipeType,
          status: p.evidenceBundle.status,
          environmentHash: p.evidenceBundle.environmentHash,
          inputsHash: p.evidenceBundle.inputsHash,
          outputsHash: p.evidenceBundle.outputsHash,
          reproducible: p.evidenceBundle.reproducible,
        } : null,
      })),
      evidenceBundles: run.evidenceBundles.map((eb) => ({
        id: eb.id,
        recipeType: eb.recipeType,
        status: eb.status,
        environmentHash: eb.environmentHash,
        inputsHash: eb.inputsHash,
        outputsHash: eb.outputsHash,
        structuredDiff: eb.structuredDiff ? JSON.parse(eb.structuredDiff) : null,
        failingTests: eb.failingTests ? JSON.parse(eb.failingTests) : null,
        reproducible: eb.reproducible,
        startedAt: eb.startedAt,
        completedAt: eb.completedAt,
      })),
      receipts: receipts.map((r) => ({
        id: r.id,
        hash: r.hash,
        signature: r.signature,
        chainPrev: r.chainPrev,
        toolCallId: r.toolCallId,
        agentPubkey: r.agentPubkey,
        toolName: r.toolName,
        riskTier: r.riskTier,
        policyDecision: r.policyDecision,
        approvalDecision: r.approvalDecision,
        evidenceHash: r.evidenceHash,
        capabilityId: r.capabilityId,
        timestamp: r.timestamp,
      })),
      timeline: run.runEvents.map((e) => ({
        id: e.id,
        type: e.type,
        data: JSON.parse(e.data),
        timestamp: e.timestamp,
        sequenceNum: e.sequenceNum,
      })),
      capabilities: run.capabilities.map((c) => ({
        id: c.id,
        actionClass: c.actionClass,
        scope: JSON.parse(c.scope),
        policySnapshot: c.policySnapshot ? JSON.parse(c.policySnapshot) : null,
        issuedAt: c.issuedAt,
        expiresAt: c.expiresAt,
        revokedAt: c.revokedAt,
        usedCount: c.usedCount,
        maxUses: c.maxUses,
      })),
      verifications: verifications.map((v) => ({
        id: v.id,
        proposalId: v.proposalId,
        status: v.status,
        expectedOutcome: JSON.parse(v.expectedOutcome),
        observedOutcome: v.observedOutcome ? JSON.parse(v.observedOutcome) : null,
        observedHash: v.observedHash,
        failureReason: v.failureReason,
        verifiedAt: v.verifiedAt,
      })),
      artifacts: artifacts.map((a) => ({
        id: a.id,
        type: a.type,
        path: a.path,
        contentHash: a.contentHash,
        sizeBytes: a.sizeBytes,
      })),
      evidenceEnvironments: evidenceEnvs.map((env) => ({
        bundleId: env.bundleId,
        baseImageDigest: env.baseImageDigest,
        osVersion: env.osVersion,
        toolchainVersions: env.toolchainVersions ? JSON.parse(env.toolchainVersions) : null,
        dependencyHash: env.dependencyHash,
        envVarHash: env.envVarHash,
        cacheStrategy: env.cacheStrategy,
      })),
      costs: run.costs.map((c) => ({
        category: c.category,
        description: c.description,
        amountCents: c.amountCents,
        quantity: c.quantity,
        unit: c.unit,
      })),
    };

    // Compute integrity hash over the entire case file
    const contentHash = createHash('sha256')
      .update(JSON.stringify(caseFile))
      .digest('hex');

    // Compute artifact manifest hash
    const artifactManifest = artifacts.map((a) => `${a.id}:${a.contentHash}`).join('\n');
    const artifactManifestHash = createHash('sha256').update(artifactManifest || 'empty').digest('hex');

    const exportPackage = {
      caseFile,
      integrity: {
        contentHash,
        receiptChainValid: verifyReceiptChain(receipts),
        receiptCount: receipts.length,
        evidenceCount: run.evidenceBundles.length,
        proposalCount: run.proposals.length,
        verificationCount: verifications.length,
        artifactCount: artifacts.length,
        artifactManifestHash,
      },
    };

    return reply.send(exportPackage);
  });

  /**
   * GET /api/case-files/:runId/verify
   *
   * Verify the integrity of a run's receipt chain.
   */
  app.get('/api/case-files/:runId/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };

    const receipts = await prisma.receipt.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });

    if (receipts.length === 0) {
      return reply.send({ valid: true, message: 'No receipts for this run', count: 0 });
    }

    const chainValid = verifyReceiptChain(receipts);

    return reply.send({
      valid: chainValid,
      count: receipts.length,
      firstReceipt: receipts[0]?.hash,
      lastReceipt: receipts[receipts.length - 1]?.hash,
    });
  });
}

/** Simple chain verification: each receipt's chainPrev matches the previous receipt's hash. */
function verifyReceiptChain(receipts: { hash: string; chainPrev: string | null }[]): boolean {
  for (let i = 1; i < receipts.length; i++) {
    if (receipts[i]!.chainPrev !== receipts[i - 1]!.hash) {
      return false;
    }
  }
  return true;
}
