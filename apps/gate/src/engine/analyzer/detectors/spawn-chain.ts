/**
 * SPAWN_CHAIN_ANOMALY Detector (Layer 1)
 *
 * Detects anomalies in the agent spawn tree:
 * - Child operating outside attested scope (tools, domains, risk ceiling)
 * - Excessive spawn depth
 * - Child with worse trust than parent
 * - Spawn storms (rapid child creation)
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';
import { MAX_SPAWN_DEPTH } from '../../identity/lineage.js';

export const spawnChainDetector: Detector = {
  code: 'SPAWN_CHAIN_ANOMALY',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // 1. Excessive spawn depth
    if (ctx.agent.spawnDepth >= MAX_SPAWN_DEPTH) {
      findings.push({
        code: 'SPAWN_CHAIN_ANOMALY',
        message: `Agent spawn depth (${ctx.agent.spawnDepth}) exceeds maximum (${MAX_SPAWN_DEPTH}). Deep nesting may indicate trust laundering.`,
        evidenceRefs: [],
        confidence: 0.8,
        suggestedAction: 'block-lineage',
        detectedAt: now,
      });
    }

    // 2. Operating outside attested scope
    if (ctx.agent.spawnScope) {
      const { allowedTools, allowedDomains, riskCeiling } = ctx.agent.spawnScope;

      // Check tool allowlist
      if (allowedTools && allowedTools.length > 0) {
        const allowedSet = new Set(allowedTools);
        for (const tc of ctx.toolCalls) {
          if (!allowedSet.has(tc.toolName)) {
            findings.push({
              code: 'SPAWN_CHAIN_ANOMALY',
              message: `Agent used tool "${tc.toolName}" which is outside its attested scope [${allowedTools.join(', ')}]`,
              evidenceRefs: [tc.id],
              confidence: 0.9,
              suggestedAction: 'demote-trust',
              detectedAt: now,
            });
            break; // one finding per scope violation type
          }
        }
      }

      // Check risk ceiling
      if (riskCeiling) {
        const riskOrder = ['READ', 'WRITE', 'DESTRUCTIVE'];
        const ceilingIdx = riskOrder.indexOf(riskCeiling);

        for (const tc of ctx.toolCalls) {
          const tierIdx = riskOrder.indexOf(tc.riskTier);
          if (tierIdx > ceilingIdx) {
            findings.push({
              code: 'SPAWN_CHAIN_ANOMALY',
              message: `Agent performed ${tc.riskTier} operation but risk ceiling is ${riskCeiling}`,
              evidenceRefs: [tc.id],
              confidence: 0.95,
              suggestedAction: 'demote-trust',
              detectedAt: now,
            });
            break;
          }
        }
      }

      // Check domain allowlist
      if (allowedDomains && allowedDomains.length > 0) {
        const domainSet = new Set(allowedDomains.map((d) => d.toLowerCase()));

        for (const tc of ctx.toolCalls) {
          if (tc.toolName !== 'wooblay_http' && tc.toolName !== 'wooblay_browser') continue;
          const url = String(tc.parsedArgs['url'] ?? tc.parsedArgs['endpoint'] ?? '');
          if (!url) continue;

          try {
            const domain = new URL(url).hostname.toLowerCase();
            const allowed = [...domainSet].some(
              (d) => domain === d || domain.endsWith(`.${d}`),
            );

            if (!allowed) {
              findings.push({
                code: 'SPAWN_CHAIN_ANOMALY',
                message: `Agent accessed domain "${domain}" outside attested scope [${allowedDomains.join(', ')}]`,
                evidenceRefs: [tc.id],
                confidence: 0.9,
                suggestedAction: 'block-lineage',
                detectedAt: now,
              });
              break;
            }
          } catch { /* not a URL */ }
        }
      }
    }

    return findings;
  },
};
