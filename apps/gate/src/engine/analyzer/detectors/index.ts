/**
 * Detector Registry Setup
 *
 * Creates and populates the detector registry with all Layer 0 + Layer 1 detectors.
 */

import { DetectorRegistry } from '../detector.js';

// Layer 0: Deterministic
import { destructiveCmdDetector } from './destructive-cmd.js';
import { domainDriftDetector } from './domain-drift.js';
import { retryLoopDetector } from './retry-loop.js';
import { approvalBypassDetector } from './approval-bypass.js';
import { readonlyViolationDetector } from './readonly-violation.js';
import { costTimeBaselineDetector } from './cost-time-baseline.js';
import { humanInterventionDetector } from './human-intervention.js';

// Layer 1: Statistical / Identity
import { identityDriftDetector } from './identity-drift.js';
import { crossAgentDetector } from './cross-agent.js';
import { canaryTripDetector } from './canary-trip.js';
import { spawnChainDetector } from './spawn-chain.js';

/**
 * Create a fully-populated detector registry.
 */
export function createDetectorRegistry(): DetectorRegistry {
  const registry = new DetectorRegistry();

  // Layer 0
  registry.register(destructiveCmdDetector);
  registry.register(domainDriftDetector);
  registry.register(retryLoopDetector);
  registry.register(approvalBypassDetector);
  registry.register(readonlyViolationDetector);
  registry.register(costTimeBaselineDetector);
  registry.register(humanInterventionDetector);

  // Layer 1
  registry.register(identityDriftDetector);
  registry.register(crossAgentDetector);
  registry.register(canaryTripDetector);
  registry.register(spawnChainDetector);

  return registry;
}
