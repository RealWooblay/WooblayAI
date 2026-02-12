/**
 * CROSS_AGENT_CORRELATION Detector (Layer 1)
 *
 * Detects suspicious correlations across multiple agents:
 * - Two agents accessing the same sensitive path within a time window
 * - Denied action for agent A appearing from agent B shortly after
 * - Multiple agents showing correlated behavioral drift
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

/** Time window for cross-agent correlation (5 minutes). */
const CORRELATION_WINDOW_MS = 5 * 60 * 1000;

/** Sensitive path patterns that trigger cross-agent correlation. */
const SENSITIVE_PATTERNS = [
  /\.env\b/,
  /\/etc\b/,
  /\.ssh\b/,
  /credentials?\b/,
  /secrets?\b/,
  /\.git\/config\b/,
  /id_rsa\b/,
  /\.aws\b/,
  /\.kube\b/,
];

export const crossAgentDetector: Detector = {
  code: 'CROSS_AGENT_CORRELATION',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    if (ctx.siblingToolCalls.length === 0) return findings;

    // 1. Check for denied action being retried by sibling
    const myDeniedReceipts = ctx.receipts.filter(
      (r) => r.policyDecision === 'DENY' && r.agentPubkey === ctx.agent.pubkey,
    );

    for (const denied of myDeniedReceipts) {
      const deniedTime = new Date(denied.timestamp).getTime();
      const windowEnd = deniedTime + CORRELATION_WINDOW_MS;

      const siblingRetries = ctx.siblingToolCalls.filter((tc) => {
        if (tc.toolName !== denied.toolName) return false;
        const tcTime = tc.createdAt.getTime();
        return tcTime > deniedTime && tcTime <= windowEnd;
      });

      for (const retry of siblingRetries) {
        findings.push({
          code: 'CROSS_AGENT_CORRELATION',
          message: `"${denied.toolName}" denied for this agent, then attempted by sibling ${retry.agentPubkey.slice(0, 12)}... ${Math.round((retry.createdAt.getTime() - deniedTime) / 1000)}s later. Possible coordinated bypass.`,
          evidenceRefs: [denied.id, retry.id],
          confidence: 0.8,
          suggestedAction: 'block-lineage',
          detectedAt: now,
        });
      }
    }

    // 2. Check for sensitive path access overlap
    for (const myCall of ctx.toolCalls) {
      const myCmd = String(myCall.parsedArgs['command'] ?? myCall.parsedArgs['cmd'] ?? '');
      if (!myCmd) continue;

      const mySensitive = SENSITIVE_PATTERNS.some((p) => p.test(myCmd));
      if (!mySensitive) continue;

      for (const sibCall of ctx.siblingToolCalls) {
        const sibCmd = String(sibCall.parsedArgs['command'] ?? sibCall.parsedArgs['cmd'] ?? '');
        if (!sibCmd) continue;

        const sibSensitive = SENSITIVE_PATTERNS.some((p) => p.test(sibCmd));
        if (!sibSensitive) continue;

        const timeDiff = Math.abs(myCall.createdAt.getTime() - sibCall.createdAt.getTime());
        if (timeDiff <= CORRELATION_WINDOW_MS) {
          findings.push({
            code: 'CROSS_AGENT_CORRELATION',
            message: `Both this agent and sibling ${sibCall.agentPubkey.slice(0, 12)}... accessed sensitive paths within ${Math.round(timeDiff / 1000)}s of each other`,
            evidenceRefs: [myCall.id, sibCall.id],
            confidence: 0.7,
            suggestedAction: 'needs-human',
            detectedAt: now,
          });
          break; // one finding per sensitive overlap
        }
      }
    }

    return findings;
  },
};
