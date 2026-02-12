/**
 * Detector Unit Tests
 *
 * Tests each detector against golden fixtures.
 */

import { describe, it, expect } from 'vitest';
import { destructiveCmdDetector } from '../../engine/analyzer/detectors/destructive-cmd.js';
import { domainDriftDetector } from '../../engine/analyzer/detectors/domain-drift.js';
import { retryLoopDetector } from '../../engine/analyzer/detectors/retry-loop.js';
import { approvalBypassDetector } from '../../engine/analyzer/detectors/approval-bypass.js';
import { readonlyViolationDetector } from '../../engine/analyzer/detectors/readonly-violation.js';
import { spawnChainDetector } from '../../engine/analyzer/detectors/spawn-chain.js';
import { identityDriftDetector } from '../../engine/analyzer/detectors/identity-drift.js';
import { canaryTripDetector } from '../../engine/analyzer/detectors/canary-trip.js';
import {
  destructiveCmdContext,
  benignContext,
  domainDriftContext,
  retryLoopContext,
  approvalBypassContext,
  readonlyViolationContext,
  spawnChainContext,
  identityDriftContext,
  canaryTripContext,
} from './fixtures/contexts.js';

describe('DESTRUCTIVE_CMD detector', () => {
  it('detects rm -rf pattern', () => {
    const findings = destructiveCmdDetector.detect(destructiveCmdContext());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].code).toBe('DESTRUCTIVE_CMD');
    expect(findings[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('detects curl|bash pattern', () => {
    const findings = destructiveCmdDetector.detect(destructiveCmdContext());
    const curlBash = findings.find((f) => f.message.includes('curl'));
    expect(curlBash).toBeDefined();
    expect(curlBash!.confidence).toBe(1.0);
  });

  it('ignores benign commands', () => {
    const findings = destructiveCmdDetector.detect(benignContext());
    expect(findings.length).toBe(0);
  });
});

describe('DOMAIN_DRIFT detector', () => {
  it('detects access outside allowed domains', () => {
    const findings = domainDriftDetector.detect(domainDriftContext());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('DOMAIN_DRIFT');
    expect(findings[0].message).toContain('evil-site.com');
  });

  it('allows whitelisted domains', () => {
    const ctx = domainDriftContext();
    ctx.toolCalls = ctx.toolCalls.filter((tc) => tc.parsedArgs['url'] === 'https://allowed-api.com/data');
    const findings = domainDriftDetector.detect(ctx);
    expect(findings.length).toBe(0);
  });
});

describe('RETRY_LOOP detector', () => {
  it('detects repeated identical calls', () => {
    const findings = retryLoopDetector.detect(retryLoopContext());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].code).toBe('RETRY_LOOP');
    expect(findings[0].message).toContain('5 times');
  });

  it('ignores sparse calls', () => {
    const ctx = benignContext();
    const findings = retryLoopDetector.detect(ctx);
    expect(findings.length).toBe(0);
  });
});

describe('APPROVAL_BYPASS detector', () => {
  it('detects denial followed by mutated retry', () => {
    const findings = approvalBypassDetector.detect(approvalBypassContext());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].code).toBe('APPROVAL_BYPASS');
    expect(findings[0].suggestedAction).toBe('suspend-agent');
  });
});

describe('READONLY_VIOLATION detector', () => {
  it('detects write from read-only agent', () => {
    const findings = readonlyViolationDetector.detect(readonlyViolationContext());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].code).toBe('READONLY_VIOLATION');
    expect(findings[0].suggestedAction).toBe('demote-trust');
  });
});

describe('SPAWN_CHAIN_ANOMALY detector', () => {
  it('detects excessive spawn depth', () => {
    const findings = spawnChainDetector.detect(spawnChainContext());
    const depthFinding = findings.find((f) => f.message.includes('spawn depth'));
    expect(depthFinding).toBeDefined();
    expect(depthFinding!.confidence).toBe(0.8);
  });

  it('detects tool outside attested scope', () => {
    const findings = spawnChainDetector.detect(spawnChainContext());
    const scopeFinding = findings.find((f) => f.message.includes('outside its attested scope'));
    expect(scopeFinding).toBeDefined();
  });

  it('detects risk ceiling violation', () => {
    const findings = spawnChainDetector.detect(spawnChainContext());
    const ceilingFinding = findings.find((f) => f.message.includes('risk ceiling'));
    expect(ceilingFinding).toBeDefined();
  });
});

describe('IDENTITY_DRIFT detector', () => {
  it('detects behavioral drift from stored profile', () => {
    const findings = identityDriftDetector.detect(identityDriftContext());
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0].code).toBe('IDENTITY_DRIFT');
    // The live behavior is completely different from stored profile
    expect(findings[0].confidence).toBeGreaterThan(0.3);
  });

  it('requires stored profile', () => {
    const ctx = benignContext();
    ctx.agent.profile = null;
    const findings = identityDriftDetector.detect(ctx);
    expect(findings.length).toBe(0);
  });
});

describe('CANARY_TRIP detector', () => {
  it('detects access to honeypot path', () => {
    const findings = canaryTripDetector.detect(canaryTripContext());
    expect(findings.length).toBe(1);
    expect(findings[0].code).toBe('CANARY_TRIP');
    expect(findings[0].confidence).toBe(1.0);
    expect(findings[0].suggestedAction).toBe('suspend-agent');
  });
});
