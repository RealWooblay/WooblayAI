/**
 * COST_TIME_BASELINE Detector (Layer 0)
 *
 * Compares task duration and tool-call count against per-agent rolling averages.
 * Flags when current task exceeds p95 baseline by 2x.
 */

import type { Finding, AgentBaseline } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

/** Factor above p95 that triggers a finding. */
const DEVIATION_FACTOR = 2.0;

export const costTimeBaselineDetector: Detector = {
  code: 'COST_TIME_BASELINE',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // Need a baseline to compare against
    let baseline: AgentBaseline | null = null;
    // Baseline is stored on the agent but not directly in ctx.agent (it's in DB)
    // We check if there's profile data that suggests we have enough history
    if (!ctx.agent.profile || ctx.agent.profile.sampleSize < 20) return findings;

    // Use profile stats as a proxy for baseline
    const avgCallsPerTask = ctx.agent.profile.avgToolCallsPerTask;
    const currentCallCount = ctx.toolCalls.length;

    if (avgCallsPerTask > 0 && currentCallCount > avgCallsPerTask * DEVIATION_FACTOR) {
      const ratio = currentCallCount / avgCallsPerTask;
      findings.push({
        code: 'COST_TIME_BASELINE',
        message: `Task used ${currentCallCount} tool calls, which is ${ratio.toFixed(1)}x the agent's average of ${avgCallsPerTask.toFixed(1)}`,
        evidenceRefs: ctx.toolCalls.slice(-5).map((tc) => tc.id), // last 5 calls as evidence
        confidence: Math.min(1.0, (ratio - DEVIATION_FACTOR) / DEVIATION_FACTOR),
        suggestedAction: 'review-policy',
        detectedAt: now,
      });
    }

    // Check session duration if we have task-scoped data
    if (ctx.taskId && ctx.toolCalls.length >= 2) {
      const sorted = [...ctx.toolCalls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      const sessionDurationMs = sorted[sorted.length - 1].createdAt.getTime() - sorted[0].createdAt.getTime();
      const avgDuration = ctx.agent.profile.avgSessionDurationMs;

      if (avgDuration > 0 && sessionDurationMs > avgDuration * DEVIATION_FACTOR) {
        const ratio = sessionDurationMs / avgDuration;
        findings.push({
          code: 'COST_TIME_BASELINE',
          message: `Task duration (${Math.round(sessionDurationMs / 1000)}s) is ${ratio.toFixed(1)}x the agent's average of ${Math.round(avgDuration / 1000)}s`,
          evidenceRefs: [sorted[0].id, sorted[sorted.length - 1].id],
          confidence: Math.min(1.0, (ratio - DEVIATION_FACTOR) / DEVIATION_FACTOR),
          suggestedAction: 'info-only',
          detectedAt: now,
        });
      }
    }

    return findings;
  },
};
