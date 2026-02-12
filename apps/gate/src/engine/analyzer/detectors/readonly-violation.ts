/**
 * READONLY_VIOLATION Detector (Layer 0)
 *
 * Detects WRITE/DESTRUCTIVE tool calls that occur after a period of
 * exclusively READ calls. Also checks trust level permissions.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

/** Minimum read-only period (in ms) before a write triggers this detector. */
const READ_ONLY_WINDOW_MS = 20 * 60 * 1000; // 20 minutes

export const readonlyViolationDetector: Detector = {
  code: 'READONLY_VIOLATION',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // Check if trust level permits writes
    if (ctx.agent.trustLevel === 'read-only') {
      const writeCalls = ctx.toolCalls.filter(
        (tc) => tc.riskTier === 'WRITE' || tc.riskTier === 'DESTRUCTIVE',
      );

      for (const wc of writeCalls) {
        findings.push({
          code: 'READONLY_VIOLATION',
          message: `Agent with trust level "read-only" attempted ${wc.riskTier} operation: ${wc.toolName}`,
          evidenceRefs: [wc.id],
          confidence: 0.9,
          suggestedAction: 'demote-trust',
          detectedAt: now,
        });
      }
    }

    // Check for mode switch: long period of reads followed by writes
    const sorted = [...ctx.toolCalls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (let i = 0; i < sorted.length; i++) {
      const tc = sorted[i];
      if (tc.riskTier !== 'WRITE' && tc.riskTier !== 'DESTRUCTIVE') continue;

      // Look back to see if there was a read-only period
      let readOnlyStreak = 0;
      let firstReadTime: Date | null = null;

      for (let j = i - 1; j >= 0; j--) {
        if (sorted[j].riskTier === 'READ') {
          readOnlyStreak++;
          firstReadTime = sorted[j].createdAt;
        } else {
          break; // streak broken
        }
      }

      if (readOnlyStreak >= 3 && firstReadTime) {
        const readDuration = tc.createdAt.getTime() - firstReadTime.getTime();
        if (readDuration >= READ_ONLY_WINDOW_MS) {
          findings.push({
            code: 'READONLY_VIOLATION',
            message: `${tc.riskTier} operation after ${Math.round(readDuration / 60000)}min of exclusively READ calls (${readOnlyStreak} reads)`,
            evidenceRefs: [tc.id],
            confidence: 0.6,
            suggestedAction: 'needs-human',
            detectedAt: now,
          });
          break; // one finding per analysis
        }
      }
    }

    return findings;
  },
};
