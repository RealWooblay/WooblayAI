/**
 * Receipt Analyzer Pipeline Orchestrator
 *
 * Orchestrates the full analysis flow:
 *   1. Collect data (collector)
 *   2. Load canaries
 *   3. Run detectors (Layer 0 + Layer 1)
 *   4. Build causal chains
 *   5. Generate summaries (Layer 2 narrator)
 *   6. Compute severity roll-up
 *   7. Persist Analysis record
 *   8. Update trust scores
 *   9. Update behavioral fingerprint
 */

import type { PrismaClient } from '@prisma/client';
import type { Finding, Severity, CausalChainNode } from '@wooblay/types';
import { collectForReceipt, collectForTask, type DetectorContext } from './collector.js';
import { createDetectorRegistry } from './detectors/index.js';
import type { DetectorContextWithCanaries } from './detectors/canary-trip.js';
import { buildCausalChain } from './causal.js';
import { createNarrator, type NarratorInput, type BriefInput } from './narrator.js';
import { updateTrustScore } from '../identity/trust.js';
import { computeAgentProfile } from '../identity/fingerprint.js';
import { getAncestorChain } from '../identity/lineage.js';
import { compareProfiles } from '../identity/fingerprint.js';
import { persistEvent } from '../../events/bus.js';

// ── Singleton instances ───────────────────────────────────────────────────────

const registry = createDetectorRegistry();
const narrator = createNarrator();

// ── Severity roll-up ──────────────────────────────────────────────────────────

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

function findingSeverity(finding: Finding): Severity {
  switch (finding.code) {
    case 'CANARY_TRIP':
    case 'APPROVAL_BYPASS':
      return 'CRITICAL';
    case 'DESTRUCTIVE_CMD':
      return finding.confidence >= 0.9 ? 'CRITICAL' : 'HIGH';
    case 'RETRY_LOOP':
      return finding.confidence >= 0.5 ? 'HIGH' : 'MEDIUM';
    case 'READONLY_VIOLATION':
    case 'IDENTITY_DRIFT':
    case 'CROSS_AGENT_CORRELATION':
    case 'SPAWN_CHAIN_ANOMALY':
      return finding.confidence >= 0.6 ? 'HIGH' : 'MEDIUM';
    case 'DOMAIN_DRIFT':
    case 'COST_TIME_BASELINE':
      return 'MEDIUM';
    case 'HUMAN_INTERVENTION':
      return 'LOW';
    default:
      return 'INFO';
  }
}

function rollUpSeverity(findings: Finding[]): Severity {
  if (findings.length === 0) return 'INFO';

  let maxSev: Severity = 'INFO';
  for (const f of findings) {
    const sev = findingSeverity(f);
    if (SEVERITY_ORDER.indexOf(sev) < SEVERITY_ORDER.indexOf(maxSev)) {
      maxSev = sev;
    }
  }

  return maxSev;
}

function extractTags(findings: Finding[]): string[] {
  return [...new Set(findings.map((f) => f.code.toLowerCase().replace(/_/g, '-')))];
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AnalysisResult {
  analysisId: string;
  severity: Severity;
  findings: Finding[];
  summary: string;
  causalChain: CausalChainNode[] | null;
  briefMarkdown: string | null;
}

/**
 * Run analysis for a single receipt (triggered on receipt.created).
 */
export async function analyzeReceipt(
  prisma: PrismaClient,
  receiptId: string,
): Promise<AnalysisResult | null> {
  const ctx = await collectForReceipt(prisma, receiptId);
  if (!ctx) return null;

  return runPipeline(prisma, ctx, { receiptId });
}

/**
 * Run analysis for a full task (triggered on score.created or recompute).
 */
export async function analyzeTask(
  prisma: PrismaClient,
  taskId: string,
  agentPubkey: string,
): Promise<AnalysisResult | null> {
  const ctx = await collectForTask(prisma, taskId, agentPubkey);
  if (!ctx) return null;

  return runPipeline(prisma, ctx, { taskId });
}

/**
 * Recompute analysis for a task (deletes old, re-runs pipeline).
 */
export async function recomputeAnalysis(
  prisma: PrismaClient,
  taskId: string,
): Promise<AnalysisResult[]> {
  // Find all agents involved in this task
  const toolCalls = await prisma.toolCall.findMany({
    where: { taskId },
    select: { agentPubkey: true },
    distinct: ['agentPubkey'],
  });

  // Delete old analyses
  await prisma.analysis.deleteMany({ where: { taskId } });

  const results: AnalysisResult[] = [];

  for (const tc of toolCalls) {
    const result = await analyzeTask(prisma, taskId, tc.agentPubkey);
    if (result) results.push(result);
  }

  return results;
}

// ── Internal pipeline ─────────────────────────────────────────────────────────

async function runPipeline(
  prisma: PrismaClient,
  ctx: DetectorContext,
  scope: { receiptId?: string; taskId?: string },
): Promise<AnalysisResult> {
  // 1. Load canaries into context
  const canaries = await prisma.canary.findMany({
    where: { active: true, trippedBy: null },
    select: { id: true, type: true, value: true, description: true },
  });
  (ctx as DetectorContextWithCanaries).canaries = canaries;

  // 2. Run all detectors
  const findings = registry.runAll(ctx);

  // 3. Build causal chain
  const causalChain = buildCausalChain(ctx, findings);

  // 4. Compute severity
  const severity = rollUpSeverity(findings);
  const tags = extractTags(findings);

  // 5. Generate summary via narrator
  const narratorInput: NarratorInput = {
    agentName: ctx.agent.name,
    agentPubkey: ctx.agent.pubkey,
    trustLevel: ctx.agent.trustLevel,
    trustScore: ctx.agent.trustScore,
    toolCalls: ctx.toolCalls.map((tc) => ({
      toolName: tc.toolName,
      args: tc.parsedArgs,
      riskTier: tc.riskTier,
    })),
    findings,
    receipts: ctx.receipts.map((r) => ({
      hash: r.hash,
      toolName: r.toolName,
      policyDecision: r.policyDecision,
      timestamp: r.timestamp,
    })),
    mode: scope.taskId ? 'task' : 'receipt',
    taskId: scope.taskId,
  };

  const summary = await narrator.summarize(narratorInput);

  // 6. Generate prosecution brief for CRITICAL
  let briefMarkdown: string | null = null;
  if (severity === 'CRITICAL') {
    const ancestors = await getAncestorChain(prisma, ctx.agent.pubkey);
    let profileSimilarity: number | null = null;

    if (ctx.agent.profile) {
      const freshProfile = await computeAgentProfile(prisma, ctx.agent.pubkey);
      if (freshProfile) {
        profileSimilarity = compareProfiles(ctx.agent.profile, freshProfile);
      }
    }

    const briefInput: BriefInput = {
      ...narratorInput,
      causalChain,
      lineage: ancestors,
      profileSimilarity,
    };

    briefMarkdown = await narrator.prosecutionBrief(briefInput);
  }

  // 7. Persist Analysis record
  const analysis = await prisma.analysis.create({
    data: {
      taskId: scope.taskId ?? null,
      receiptId: scope.receiptId ?? null,
      agentPubkey: ctx.agent.pubkey,
      severity,
      tags: JSON.stringify(tags),
      summary,
      findings: JSON.stringify(findings),
      causalChain: causalChain ? JSON.stringify(causalChain) : null,
      briefMarkdown,
    },
  });

  // 8. Emit analysis.created event
  await persistEvent(prisma, {
    type: 'analysis.created',
    data: {
      analysisId: analysis.id,
      agentPubkey: ctx.agent.pubkey,
      severity,
      taskId: scope.taskId,
      receiptId: scope.receiptId,
    },
  });

  // 9. Update trust score
  const isCleanTask = findings.length === 0 && scope.taskId !== undefined;
  await updateTrustScore(prisma, ctx.agent.pubkey, findings, isCleanTask);

  // 10. Update behavioral fingerprint (async, don't block)
  computeAgentProfile(prisma, ctx.agent.pubkey).then(async (profile) => {
    if (profile) {
      await prisma.agent.update({
        where: { pubkey: ctx.agent.pubkey },
        data: { profileJson: JSON.stringify(profile) },
      });
    }
  }).catch((err) => {
    console.error('[analyzer] Failed to update agent profile:', err);
  });

  // 11. Trip canaries if any matched
  const canaryFindings = findings.filter((f) => f.code === 'CANARY_TRIP');
  for (const cf of canaryFindings) {
    for (const ref of cf.evidenceRefs) {
      const canary = canaries.find((c) => c.id === ref);
      if (canary) {
        await prisma.canary.update({
          where: { id: canary.id },
          data: { trippedBy: ctx.agent.pubkey, trippedAt: new Date() },
        });
        await persistEvent(prisma, {
          type: 'canary.tripped',
          data: { canaryId: canary.id, agentPubkey: ctx.agent.pubkey, type: canary.type },
        });
      }
    }
  }

  return {
    analysisId: analysis.id,
    severity,
    findings,
    summary,
    causalChain,
    briefMarkdown,
  };
}
