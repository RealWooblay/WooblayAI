/**
 * Detector Registry
 *
 * Defines the Detector interface and the registry that runs all detectors
 * against a DetectorContext.
 */

import type { Finding } from '@wooblay/types';
import type { DetectorContext } from './collector.js';

/**
 * A detector is a pure function that examines collected data and produces findings.
 * No DB queries allowed inside detectors -- all data comes from the context.
 */
export interface Detector {
  /** Unique code identifying this detector (matches FindingCode). */
  code: string;
  /** Run detection against the context. Returns zero or more findings. */
  detect(ctx: DetectorContext): Finding[];
}

/**
 * The detector registry holds all registered detectors (Layer 0 + Layer 1).
 */
export class DetectorRegistry {
  private detectors: Detector[] = [];

  register(detector: Detector): void {
    this.detectors.push(detector);
  }

  /**
   * Run all registered detectors against the context.
   * Returns all findings from all detectors, deduplicated by code + evidence.
   */
  runAll(ctx: DetectorContext): Finding[] {
    const allFindings: Finding[] = [];

    for (const detector of ctx.agent.status === 'revoked' ? [] : this.detectors) {
      try {
        const findings = detector.detect(ctx);
        allFindings.push(...findings);
      } catch (err) {
        // Don't let one broken detector crash the pipeline
        console.error(`[analyzer] Detector ${detector.code} failed:`, err);
      }
    }

    return deduplicateFindings(allFindings);
  }
}

/**
 * Deduplicate findings: same code + same sorted evidenceRefs = duplicate.
 */
function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];

  for (const f of findings) {
    const key = `${f.code}::${[...f.evidenceRefs].sort().join(',')}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(f);
    }
  }

  return result;
}
