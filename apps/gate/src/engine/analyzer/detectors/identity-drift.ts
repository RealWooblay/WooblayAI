/**
 * IDENTITY_DRIFT Detector (Layer 1)
 *
 * Computes a live behavioral vector from the current session and compares
 * it against the stored agent profile using cosine similarity.
 * Detects prompt injection, model contamination, or compromised credentials.
 */

import type { Finding, AgentProfile } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';
import { cosineSimilarity, compareProfiles } from '../../identity/fingerprint.js';

/** Below this similarity = MEDIUM finding. */
const DRIFT_THRESHOLD_MEDIUM = 0.7;

/** Below this similarity = HIGH finding. */
const DRIFT_THRESHOLD_HIGH = 0.4;

/** Minimum tool calls needed to compute a live profile. */
const MIN_CALLS_FOR_LIVE_PROFILE = 5;

export const identityDriftDetector: Detector = {
  code: 'IDENTITY_DRIFT',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // Need stored profile and enough current data
    if (!ctx.agent.profile) return findings;
    if (ctx.toolCalls.length < MIN_CALLS_FOR_LIVE_PROFILE) return findings;

    // Build a live profile from the current context
    const liveProfile = buildLiveProfile(ctx);
    if (!liveProfile) return findings;

    const similarity = compareProfiles(ctx.agent.profile, liveProfile);

    if (similarity < DRIFT_THRESHOLD_HIGH) {
      findings.push({
        code: 'IDENTITY_DRIFT',
        message: `Severe behavioral drift detected: ${(similarity * 100).toFixed(0)}% match to stored profile. Possible prompt injection or credential compromise.`,
        evidenceRefs: ctx.toolCalls.slice(0, 10).map((tc) => tc.id),
        confidence: 1 - similarity, // lower similarity = higher confidence
        suggestedAction: 'suspend-agent',
        decayRate: 0.97,
        detectedAt: now,
      });
    } else if (similarity < DRIFT_THRESHOLD_MEDIUM) {
      findings.push({
        code: 'IDENTITY_DRIFT',
        message: `Behavioral drift detected: ${(similarity * 100).toFixed(0)}% match to stored profile. Agent behavior has shifted.`,
        evidenceRefs: ctx.toolCalls.slice(0, 5).map((tc) => tc.id),
        confidence: Math.min(0.8, 1 - similarity),
        suggestedAction: 'needs-human',
        detectedAt: now,
      });
    }

    return findings;
  },
};

/**
 * Build a quick profile from the current context's tool calls.
 */
function buildLiveProfile(ctx: DetectorContext): AgentProfile | null {
  const calls = ctx.toolCalls;
  if (calls.length < MIN_CALLS_FOR_LIVE_PROFILE) return null;

  const toolCounts: Record<string, number> = {};
  const riskCounts: Record<string, number> = {};
  const domainCounts: Record<string, number> = {};

  for (const tc of calls) {
    toolCounts[tc.toolName] = (toolCounts[tc.toolName] ?? 0) + 1;
    riskCounts[tc.riskTier] = (riskCounts[tc.riskTier] ?? 0) + 1;

    if (tc.toolName === 'wooblay_http' || tc.toolName === 'wooblay_browser') {
      const url = String(tc.parsedArgs['url'] ?? tc.parsedArgs['endpoint'] ?? '');
      if (url) {
        try {
          const domain = new URL(url).hostname;
          domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
        } catch { /* ignore */ }
      }
    }
  }

  const toolMix: Record<string, number> = {};
  for (const [k, v] of Object.entries(toolCounts)) toolMix[k] = v / calls.length;

  const riskMix: Record<string, number> = {};
  for (const [k, v] of Object.entries(riskCounts)) riskMix[k] = v / calls.length;

  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([d]) => d);

  // Timing
  const sorted = [...calls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i].createdAt.getTime() - sorted[i - 1].createdAt.getTime());
  }

  return {
    toolMix,
    riskMix,
    avgSessionDurationMs: sorted.length >= 2
      ? sorted[sorted.length - 1].createdAt.getTime() - sorted[0].createdAt.getTime()
      : 0,
    avgToolCallsPerTask: calls.length,
    avgTimeBetweenCallsMs: gaps.length > 0 ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0,
    approvalRate: 0, // can't compute without approval data in live context
    denialRate: 0,
    topDomains,
    computedAt: new Date().toISOString(),
    sampleSize: calls.length,
  };
}
