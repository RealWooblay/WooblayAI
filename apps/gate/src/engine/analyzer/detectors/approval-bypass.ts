/**
 * APPROVAL_BYPASS Detector (Layer 0)
 *
 * Detects attempts to circumvent denials by mutating args slightly.
 * Also checks for sibling agents retrying denied actions.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

/** Simple Levenshtein distance (capped for performance). */
function levenshtein(a: string, b: string, maxDist = 50): number {
  if (a === b) return 0;
  if (a.length > 500) a = a.slice(0, 500);
  if (b.length > 500) b = b.slice(0, 500);

  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Bail if lengths differ too much
  if (Math.abs(m - n) > maxDist) return maxDist + 1;

  const prev = new Array(n + 1);
  const curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }

  return prev[n];
}

/** Similarity threshold: args within this edit distance are "similar". */
const SIMILARITY_THRESHOLD = 20;

/** Time window to look for retries after denial (5 minutes). */
const RETRY_WINDOW_MS = 5 * 60 * 1000;

export const approvalBypassDetector: Detector = {
  code: 'APPROVAL_BYPASS',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // Find denied receipts
    const deniedReceipts = ctx.receipts.filter(
      (r) => r.policyDecision === 'DENY' && r.agentPubkey === ctx.agent.pubkey,
    );

    for (const denied of deniedReceipts) {
      const deniedTime = new Date(denied.timestamp).getTime();
      const windowEnd = deniedTime + RETRY_WINDOW_MS;

      // Find subsequent calls with the same tool but mutated args
      const candidates = ctx.toolCalls.filter((tc) => {
        if (tc.toolName !== denied.toolName) return false;
        const tcTime = tc.createdAt.getTime();
        return tcTime > deniedTime && tcTime <= windowEnd;
      });

      for (const candidate of candidates) {
        // Compare args (find the denied tool call's args)
        const deniedCall = ctx.toolCalls.find((tc) => tc.id === denied.toolCallId);
        if (!deniedCall) continue;

        const dist = levenshtein(deniedCall.args, candidate.args);
        if (dist > 0 && dist <= SIMILARITY_THRESHOLD) {
          findings.push({
            code: 'APPROVAL_BYPASS',
            message: `"${denied.toolName}" was denied, then retried with mutated args (edit distance: ${dist}) within ${RETRY_WINDOW_MS / 60000}min`,
            evidenceRefs: [denied.id, candidate.id],
            confidence: 0.85,
            suggestedAction: 'suspend-agent',
            decayRate: 0.98,
            detectedAt: now,
          });
        }
      }
    }

    // Cross-sibling bypass: did a sibling retry our denied action?
    if (ctx.siblingToolCalls.length > 0) {
      for (const denied of deniedReceipts) {
        const deniedTime = new Date(denied.timestamp).getTime();
        const windowEnd = deniedTime + RETRY_WINDOW_MS;

        const siblingRetries = ctx.siblingToolCalls.filter((tc) => {
          if (tc.toolName !== denied.toolName) return false;
          const tcTime = tc.createdAt.getTime();
          return tcTime > deniedTime && tcTime <= windowEnd;
        });

        for (const retry of siblingRetries) {
          findings.push({
            code: 'APPROVAL_BYPASS',
            message: `"${denied.toolName}" was denied for this agent, then attempted by sibling agent ${retry.agentPubkey.slice(0, 12)}... within ${RETRY_WINDOW_MS / 60000}min`,
            evidenceRefs: [denied.id, retry.id],
            confidence: 0.75,
            suggestedAction: 'block-lineage',
            decayRate: 0.98,
            detectedAt: now,
          });
        }
      }
    }

    return findings;
  },
};
