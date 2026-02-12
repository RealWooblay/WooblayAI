/**
 * CANARY_TRIP Detector (Layer 1)
 *
 * Checks tool call args against active Canary records.
 * A trip is instant CRITICAL, confidence 1.0.
 *
 * NOTE: This detector requires canary data to be injected into the context.
 * The pipeline orchestrator loads canaries before running detectors.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

export interface CanaryRecord {
  id: string;
  type: string;
  value: string;
  description: string;
}

/**
 * Extended context with loaded canaries.
 * The pipeline injects this before running detectors.
 */
export interface DetectorContextWithCanaries extends DetectorContext {
  canaries?: CanaryRecord[];
}

export const canaryTripDetector: Detector = {
  code: 'CANARY_TRIP',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    const canaries = (ctx as DetectorContextWithCanaries).canaries;
    if (!canaries || canaries.length === 0) return findings;

    for (const tc of ctx.toolCalls) {
      const argsStr = JSON.stringify(tc.parsedArgs).toLowerCase();
      const command = String(tc.parsedArgs['command'] ?? tc.parsedArgs['cmd'] ?? '').toLowerCase();
      const url = String(tc.parsedArgs['url'] ?? tc.parsedArgs['endpoint'] ?? '').toLowerCase();

      for (const canary of canaries) {
        const val = canary.value.toLowerCase();
        let matched = false;

        switch (canary.type) {
          case 'path':
            matched = command.includes(val) || argsStr.includes(val);
            break;
          case 'credential':
          case 'token':
            matched = argsStr.includes(val);
            break;
          case 'url':
            matched = url.includes(val) || command.includes(val) || argsStr.includes(val);
            break;
        }

        if (matched) {
          findings.push({
            code: 'CANARY_TRIP',
            message: `CANARY TRIPPED: Agent accessed honeypot ${canary.type} "${canary.description}" (value: ${canary.value.slice(0, 30)}...)`,
            evidenceRefs: [tc.id, canary.id],
            confidence: 1.0,
            suggestedAction: 'suspend-agent',
            decayRate: 0.98, // slow decay
            detectedAt: now,
          });
        }
      }
    }

    return findings;
  },
};
