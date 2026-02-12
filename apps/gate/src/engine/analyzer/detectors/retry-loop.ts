/**
 * RETRY_LOOP Detector (Layer 0)
 *
 * Detects when the same tool call (same tool + normalized args) is repeated
 * N+ times in a sliding window. Identity-aware: also checks if the agent is
 * retrying something its parent was denied.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext, CollectedToolCall } from '../collector.js';
import { canonicalJson } from '@wooblay/crypto';

/** Minimum repetitions to trigger a finding. */
const MIN_REPEATS = 3;

/** Time window in ms (10 minutes). */
const WINDOW_MS = 10 * 60 * 1000;

/**
 * Generate a fingerprint for a tool call (tool name + normalized args).
 */
function callFingerprint(tc: CollectedToolCall): string {
  try {
    return `${tc.toolName}::${canonicalJson(tc.parsedArgs)}`;
  } catch {
    return `${tc.toolName}::${tc.args}`;
  }
}

export const retryLoopDetector: Detector = {
  code: 'RETRY_LOOP',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();
    const cutoff = new Date(Date.now() - WINDOW_MS);

    // Count fingerprints in the window
    const recentCalls = ctx.toolCalls.filter((tc) => tc.createdAt >= cutoff);
    const fingerprints = new Map<string, CollectedToolCall[]>();

    for (const tc of recentCalls) {
      const fp = callFingerprint(tc);
      if (!fingerprints.has(fp)) fingerprints.set(fp, []);
      fingerprints.get(fp)!.push(tc);
    }

    for (const [fp, calls] of fingerprints) {
      if (calls.length < MIN_REPEATS) continue;

      const confidence = Math.min(1.0, calls.length / 10);
      const evidenceRefs = calls.map((tc) => tc.id);

      findings.push({
        code: 'RETRY_LOOP',
        message: `"${calls[0].toolName}" called ${calls.length} times with identical args in ${WINDOW_MS / 60000}min window`,
        evidenceRefs,
        confidence,
        suggestedAction: calls.length >= 5 ? 'needs-human' : 'review-policy',
        detectedAt: now,
      });
    }

    // Lineage-aware: check if retrying something parent was denied
    if (ctx.agent.parentPubkey) {
      const deniedReceipts = ctx.receipts.filter(
        (r) => r.policyDecision === 'DENY' && r.agentPubkey !== ctx.agent.pubkey,
      );

      for (const denied of deniedReceipts) {
        // Check if any of our calls match the denied call
        for (const tc of recentCalls) {
          if (tc.toolName === denied.toolName) {
            findings.push({
              code: 'RETRY_LOOP',
              message: `Agent retrying "${tc.toolName}" that was denied for a parent/sibling agent (receipt ${denied.hash.slice(0, 12)})`,
              evidenceRefs: [tc.id, denied.id],
              confidence: 0.8,
              suggestedAction: 'block-lineage',
              detectedAt: now,
            });
            break;
          }
        }
      }
    }

    return findings;
  },
};
