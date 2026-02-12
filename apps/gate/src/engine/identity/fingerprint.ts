/**
 * Behavioral Fingerprinting
 *
 * Every agent develops a statistical signature based on its tool-call patterns.
 * The fingerprint enables identity drift detection and impersonation detection.
 */

import type { PrismaClient } from '@prisma/client';
import type { AgentProfile } from '@wooblay/types';

/**
 * Compute cosine similarity between two vectors represented as Record<string, number>.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
export function cosineSimilarity(
  a: Record<string, number>,
  b: Record<string, number>,
): number {
  const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (const key of allKeys) {
    const va = a[key] ?? 0;
    const vb = b[key] ?? 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Compute the behavioral profile for an agent based on their tool call history.
 * Uses up to the last `windowSize` tool calls.
 */
export async function computeAgentProfile(
  prisma: PrismaClient,
  agentPubkey: string,
  windowSize = 200,
): Promise<AgentProfile | null> {
  const toolCalls = await prisma.toolCall.findMany({
    where: { agentPubkey },
    orderBy: { createdAt: 'desc' },
    take: windowSize,
    include: {
      receipt: { select: { policyDecision: true, approvalDecision: true } },
    },
  });

  if (toolCalls.length < 5) return null; // need minimum sample

  // Tool mix
  const toolCounts: Record<string, number> = {};
  for (const tc of toolCalls) {
    toolCounts[tc.toolName] = (toolCounts[tc.toolName] ?? 0) + 1;
  }
  const toolMix: Record<string, number> = {};
  for (const [tool, count] of Object.entries(toolCounts)) {
    toolMix[tool] = count / toolCalls.length;
  }

  // Risk mix
  const riskCounts: Record<string, number> = {};
  for (const tc of toolCalls) {
    riskCounts[tc.riskTier] = (riskCounts[tc.riskTier] ?? 0) + 1;
  }
  const riskMix: Record<string, number> = {};
  for (const [tier, count] of Object.entries(riskCounts)) {
    riskMix[tier] = count / toolCalls.length;
  }

  // Timing patterns
  const sorted = [...toolCalls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].createdAt.getTime() - sorted[i - 1].createdAt.getTime());
  }
  const avgTimeBetweenCallsMs = gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;

  // Group by task to compute per-task stats
  const taskGroups = new Map<string, typeof toolCalls>();
  for (const tc of toolCalls) {
    const taskId = tc.taskId ?? '__no_task__';
    if (!taskGroups.has(taskId)) taskGroups.set(taskId, []);
    taskGroups.get(taskId)!.push(tc);
  }

  const taskCounts = [...taskGroups.values()].map((g) => g.length);
  const avgToolCallsPerTask = taskCounts.reduce((a, b) => a + b, 0) / taskCounts.length;

  // Session duration: use first-to-last call time per task
  const sessionDurations: number[] = [];
  for (const group of taskGroups.values()) {
    if (group.length < 2) continue;
    const sortedGroup = group.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    sessionDurations.push(
      sortedGroup[sortedGroup.length - 1].createdAt.getTime() - sortedGroup[0].createdAt.getTime(),
    );
  }
  const avgSessionDurationMs =
    sessionDurations.length > 0
      ? sessionDurations.reduce((a, b) => a + b, 0) / sessionDurations.length
      : 0;

  // Approval & denial rates
  let approvalCount = 0;
  let denialCount = 0;
  for (const tc of toolCalls) {
    if (tc.receipt?.approvalDecision === 'APPROVED' || tc.receipt?.approvalDecision === 'DENIED') {
      approvalCount++;
    }
    if (tc.receipt?.policyDecision === 'DENY') {
      denialCount++;
    }
  }

  // Domain patterns
  const domainCounts: Record<string, number> = {};
  for (const tc of toolCalls) {
    if (tc.toolName === 'wooblay_http' || tc.toolName === 'wooblay_browser') {
      try {
        const args = JSON.parse(tc.args);
        const urlStr = String(args.url ?? args.endpoint ?? '');
        if (urlStr) {
          try {
            const domain = new URL(urlStr).hostname;
            domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
          } catch {
            // not a valid URL
          }
        }
      } catch {
        // args not JSON
      }
    }
  }

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);

  return {
    toolMix,
    riskMix,
    avgSessionDurationMs,
    avgToolCallsPerTask,
    avgTimeBetweenCallsMs,
    approvalRate: approvalCount / toolCalls.length,
    denialRate: denialCount / toolCalls.length,
    topDomains,
    computedAt: new Date().toISOString(),
    sampleSize: toolCalls.length,
  };
}

/**
 * Compare the live session behavior against the stored profile.
 * Returns a similarity score between 0 (completely different) and 1 (identical).
 */
export function compareProfiles(stored: AgentProfile, live: AgentProfile): number {
  // Weighted average of multiple similarity dimensions
  const toolSim = cosineSimilarity(stored.toolMix, live.toolMix);
  const riskSim = cosineSimilarity(stored.riskMix, live.riskMix);

  // Timing similarity (log-scale comparison)
  const timingSim = stored.avgTimeBetweenCallsMs > 0 && live.avgTimeBetweenCallsMs > 0
    ? 1 - Math.min(1, Math.abs(
        Math.log(live.avgTimeBetweenCallsMs / stored.avgTimeBetweenCallsMs),
      ) / 3) // 3 = ~20x difference maps to 0 similarity
    : 0.5; // neutral if missing

  // Domain overlap (Jaccard similarity)
  const storedDomainSet = new Set(stored.topDomains);
  const liveDomainSet = new Set(live.topDomains);
  const intersection = [...storedDomainSet].filter((d) => liveDomainSet.has(d)).length;
  const union = new Set([...storedDomainSet, ...liveDomainSet]).size;
  const domainSim = union > 0 ? intersection / union : 1; // 1 if both empty

  // Weighted combination
  return toolSim * 0.35 + riskSim * 0.30 + timingSim * 0.15 + domainSim * 0.20;
}
