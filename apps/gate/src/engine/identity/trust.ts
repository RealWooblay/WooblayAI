/**
 * Dynamic Trust Engine
 *
 * Computes and updates agent trust scores based on analysis findings.
 * Handles automatic trust level transitions and spawn chain accountability.
 */

import type { PrismaClient } from '@prisma/client';
import type { Finding, TrustLevel, Severity, AgentBaseline, TrustHistoryEntry } from '@wooblay/types';
import { TRUST_THRESHOLDS } from '@wooblay/types';
import { trustLevelFromScore } from './lineage.js';
import { persistEvent } from '../../events/bus.js';

// ── Penalty constants ─────────────────────────────────────────────────────────

const SEVERITY_PENALTIES: Record<Severity, [number, number]> = {
  CRITICAL: [15, 25],
  HIGH: [8, 15],
  MEDIUM: [3, 8],
  LOW: [1, 3],
  INFO: [0, 0],
};

/** Trust points gained per clean task (no findings). */
const CLEAN_TASK_REWARD = 2;

/** Trust penalty propagation factor per lineage level. */
const LINEAGE_PENALTY_DECAY = 0.3;

/** Number of consecutive clean tasks required before promotion. */
const PROMOTION_CLEAN_STREAK = 5;

// ── Confidence decay ──────────────────────────────────────────────────────────

/** Default decay rate per day (0.95 = 5% loss per day). */
export const DEFAULT_DECAY_RATE = 0.95;

/** Decay rate for CRITICAL findings (slower). */
export const CRITICAL_DECAY_RATE = 0.98;

/**
 * Compute effective confidence after time-based decay.
 */
export function decayedConfidence(
  confidence: number,
  detectedAt: string,
  decayRate?: number,
  now = new Date(),
): number {
  const rate = decayRate ?? DEFAULT_DECAY_RATE;
  const detectedDate = new Date(detectedAt);
  const daysSince = (now.getTime() - detectedDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince <= 0) return confidence;
  return confidence * Math.pow(rate, daysSince);
}

/**
 * Compute the trust penalty for a set of findings.
 * Uses the max severity finding to determine the penalty band,
 * then scales by confidence.
 */
export function computeTrustPenalty(findings: Finding[]): number {
  if (findings.length === 0) return 0;

  let totalPenalty = 0;

  for (const finding of findings) {
    const severity = findingSeverity(finding);
    const [minPen, maxPen] = SEVERITY_PENALTIES[severity];
    const effectiveConf = decayedConfidence(finding.confidence, finding.detectedAt);

    // Scale penalty by effective confidence
    const penalty = minPen + (maxPen - minPen) * effectiveConf;
    totalPenalty += penalty;
  }

  return totalPenalty;
}

/**
 * Map a finding code to its severity.
 */
function findingSeverity(finding: Finding): Severity {
  switch (finding.code) {
    case 'CANARY_TRIP':
      return 'CRITICAL';
    case 'DESTRUCTIVE_CMD':
      return finding.confidence >= 0.9 ? 'CRITICAL' : 'HIGH';
    case 'APPROVAL_BYPASS':
      return 'CRITICAL';
    case 'RETRY_LOOP':
      return finding.confidence >= 0.5 ? 'HIGH' : 'MEDIUM';
    case 'READONLY_VIOLATION':
      return 'HIGH';
    case 'IDENTITY_DRIFT':
      return finding.confidence >= 0.6 ? 'HIGH' : 'MEDIUM';
    case 'CROSS_AGENT_CORRELATION':
      return 'HIGH';
    case 'SPAWN_CHAIN_ANOMALY':
      return 'HIGH';
    case 'DOMAIN_DRIFT':
      return 'MEDIUM';
    case 'COST_TIME_BASELINE':
      return 'MEDIUM';
    case 'HUMAN_INTERVENTION':
      return 'LOW';
    default:
      return 'INFO';
  }
}

/**
 * Update an agent's trust score based on new findings.
 * Handles:
 *  - Penalty from findings
 *  - Clean task reward
 *  - Automatic trust level transitions
 *  - Spawn chain accountability (penalize parents)
 */
export async function updateTrustScore(
  prisma: PrismaClient,
  agentPubkey: string,
  findings: Finding[],
  isCleanTask: boolean,
): Promise<{ newScore: number; newLevel: TrustLevel; transitioned: boolean }> {
  const agent = await prisma.agent.findUnique({
    where: { pubkey: agentPubkey },
  });

  if (!agent) {
    throw new Error(`Agent not found: ${agentPubkey}`);
  }

  const oldLevel = agent.trustLevel as TrustLevel;
  let newScore = agent.trustScore;

  if (findings.length > 0) {
    const penalty = computeTrustPenalty(findings);
    newScore = Math.max(0, newScore - penalty);

    // CRITICAL findings = immediate demotion to read-only
    const hasCritical = findings.some((f) => findingSeverity(f) === 'CRITICAL');
    if (hasCritical) {
      newScore = Math.min(newScore, TRUST_THRESHOLDS['write-with-approvals'] - 1);
    }
  } else if (isCleanTask) {
    newScore = Math.min(100, newScore + CLEAN_TASK_REWARD);
  }

  const newLevel = trustLevelFromScore(newScore);
  const transitioned = newLevel !== oldLevel;

  // Check promotion guard: require consecutive clean tasks
  if (newLevel !== oldLevel && newLevel !== 'read-only') {
    // Only promote if we have enough clean streak
    const recentAnalyses = await prisma.analysis.findMany({
      where: { agentPubkey },
      orderBy: { createdAt: 'desc' },
      take: PROMOTION_CLEAN_STREAK,
      select: { severity: true },
    });

    const cleanStreak = recentAnalyses.filter((a) => a.severity === 'INFO').length;
    if (cleanStreak < PROMOTION_CLEAN_STREAK) {
      // Not enough clean streak -- keep the higher score but don't promote yet
      // Actually, keep the new score but cap it just below the next threshold
      const order: TrustLevel[] = ['read-only', 'write-with-approvals', 'autonomous'];
      const oldIdx = order.indexOf(oldLevel);
      const newIdx = order.indexOf(newLevel);
      if (newIdx > oldIdx) {
        // Don't promote yet, keep old level
        return await persistTrustUpdate(prisma, agentPubkey, newScore, oldLevel, false);
      }
    }
  }

  const result = await persistTrustUpdate(prisma, agentPubkey, newScore, newLevel, transitioned);

  // Emit trust change event if transitioned
  if (transitioned) {
    await persistEvent(prisma, {
      type: 'agent.trust.changed',
      data: {
        agentPubkey,
        from: oldLevel,
        to: newLevel,
        trigger: findings.length > 0 ? findings[0].code : 'clean_task',
      },
    });
  }

  // Spawn chain accountability: penalize parents
  if (findings.length > 0 && agent.parentPubkey) {
    await propagatePenaltyUpward(prisma, agent.parentPubkey, findings, 1);
  }

  return result;
}

/**
 * Persist trust score + level update.
 */
async function persistTrustUpdate(
  prisma: PrismaClient,
  agentPubkey: string,
  score: number,
  level: TrustLevel,
  transitioned: boolean,
): Promise<{ newScore: number; newLevel: TrustLevel; transitioned: boolean }> {
  // Also update baseline with trust history entry
  const agent = await prisma.agent.findUnique({
    where: { pubkey: agentPubkey },
    select: { baselineJson: true },
  });

  let baseline: AgentBaseline = {
    avgCostPerTask: 0,
    avgDurationPerTask: 0,
    avgToolCallsPerTask: 0,
    p95CostPerTask: 0,
    p95DurationPerTask: 0,
    trustHistory: [],
    updatedAt: new Date().toISOString(),
  };

  if (agent?.baselineJson) {
    try {
      baseline = JSON.parse(agent.baselineJson) as AgentBaseline;
    } catch {
      // corrupted baseline, start fresh
    }
  }

  // Append today's trust snapshot (deduplicate by date)
  const today = new Date().toISOString().slice(0, 10);
  const entry: TrustHistoryEntry = { date: today, score, level };
  const existingIdx = baseline.trustHistory.findIndex((h) => h.date === today);
  if (existingIdx >= 0) {
    baseline.trustHistory[existingIdx] = entry;
  } else {
    baseline.trustHistory.push(entry);
  }

  // Keep last 90 days
  if (baseline.trustHistory.length > 90) {
    baseline.trustHistory = baseline.trustHistory.slice(-90);
  }

  baseline.updatedAt = new Date().toISOString();

  await prisma.agent.update({
    where: { pubkey: agentPubkey },
    data: {
      trustScore: score,
      trustLevel: level,
      baselineJson: JSON.stringify(baseline),
    },
  });

  return { newScore: score, newLevel: level, transitioned };
}

/**
 * Propagate trust penalties up the lineage tree.
 * Each level reduces the penalty by LINEAGE_PENALTY_DECAY.
 */
async function propagatePenaltyUpward(
  prisma: PrismaClient,
  parentPubkey: string,
  findings: Finding[],
  depth: number,
): Promise<void> {
  if (depth > 5) return; // safety limit

  const parent = await prisma.agent.findUnique({
    where: { pubkey: parentPubkey },
    select: { pubkey: true, trustScore: true, trustLevel: true, parentPubkey: true },
  });

  if (!parent) return;

  const penalty = computeTrustPenalty(findings) * Math.pow(LINEAGE_PENALTY_DECAY, depth);
  if (penalty < 0.5) return; // negligible

  const newScore = Math.max(0, parent.trustScore - penalty);
  const newLevel = trustLevelFromScore(newScore);

  await prisma.agent.update({
    where: { pubkey: parentPubkey },
    data: { trustScore: newScore, trustLevel: newLevel },
  });

  // Continue up the tree
  if (parent.parentPubkey) {
    await propagatePenaltyUpward(prisma, parent.parentPubkey, findings, depth + 1);
  }
}
