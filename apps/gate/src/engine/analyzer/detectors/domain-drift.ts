/**
 * DOMAIN_DRIFT Detector (Layer 0)
 *
 * Detects browser/HTTP actions targeting domains outside allowlists.
 * Checks against both spawn-attested allowedDomains and the agent's
 * behavioral profile topDomains.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

/**
 * Extract domain from a URL string, returning null if not parseable.
 */
function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    // Try adding protocol
    try {
      return new URL(`https://${url}`).hostname;
    } catch {
      return null;
    }
  }
}

export const domainDriftDetector: Detector = {
  code: 'DOMAIN_DRIFT',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // Build allowlist from spawn scope + profile
    const allowedDomains = new Set<string>();

    if (ctx.agent.spawnScope?.allowedDomains) {
      for (const d of ctx.agent.spawnScope.allowedDomains) {
        allowedDomains.add(d.toLowerCase());
      }
    }

    if (ctx.agent.profile?.topDomains) {
      for (const d of ctx.agent.profile.topDomains) {
        allowedDomains.add(d.toLowerCase());
      }
    }

    // If no allowlist is configured, skip (can't detect drift without a baseline)
    if (allowedDomains.size === 0) return findings;

    for (const tc of ctx.toolCalls) {
      if (tc.toolName !== 'wooblay_http' && tc.toolName !== 'wooblay_browser') continue;

      const url = String(tc.parsedArgs['url'] ?? tc.parsedArgs['endpoint'] ?? '');
      if (!url) continue;

      const domain = extractDomain(url);
      if (!domain) continue;

      // Check if domain matches any allowlisted domain (supports subdomain matching)
      const isAllowed = [...allowedDomains].some((allowed) => {
        return domain === allowed || domain.endsWith(`.${allowed}`);
      });

      if (!isAllowed) {
        const hasScope = ctx.agent.spawnScope?.allowedDomains && ctx.agent.spawnScope.allowedDomains.length > 0;
        findings.push({
          code: 'DOMAIN_DRIFT',
          message: `${tc.toolName} accessed "${domain}" which is outside ${hasScope ? 'attested scope' : 'behavioral profile'}. Allowed: [${[...allowedDomains].slice(0, 5).join(', ')}]`,
          evidenceRefs: [tc.id],
          confidence: hasScope ? 0.95 : 0.7, // higher if scope explicitly set
          suggestedAction: 'needs-human',
          detectedAt: now,
        });
      }
    }

    return findings;
  },
};
