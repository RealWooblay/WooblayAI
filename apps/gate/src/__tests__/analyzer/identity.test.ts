/**
 * Identity System Unit Tests
 *
 * Tests lineage, trust computation, fingerprint similarity, and confidence decay.
 */

import { describe, it, expect } from 'vitest';
import {
  computeInheritedTrust,
  trustLevelFromScore,
  capTrustByRiskCeiling,
  TRUST_INHERITANCE_FACTOR,
} from '../../engine/identity/lineage.js';
import { cosineSimilarity, compareProfiles } from '../../engine/identity/fingerprint.js';
import { decayedConfidence, computeTrustPenalty, DEFAULT_DECAY_RATE, CRITICAL_DECAY_RATE } from '../../engine/identity/trust.js';
import type { AgentProfile, Finding } from '@wooblay/types';

describe('Trust Level from Score', () => {
  it('returns read-only for low scores', () => {
    expect(trustLevelFromScore(0)).toBe('read-only');
    expect(trustLevelFromScore(20)).toBe('read-only');
    expect(trustLevelFromScore(39)).toBe('read-only');
  });

  it('returns write-with-approvals for mid scores', () => {
    expect(trustLevelFromScore(40)).toBe('write-with-approvals');
    expect(trustLevelFromScore(60)).toBe('write-with-approvals');
    expect(trustLevelFromScore(79)).toBe('write-with-approvals');
  });

  it('returns autonomous for high scores', () => {
    expect(trustLevelFromScore(80)).toBe('autonomous');
    expect(trustLevelFromScore(100)).toBe('autonomous');
  });
});

describe('Trust Inheritance', () => {
  it('applies inheritance factor per spawn depth', () => {
    const parentScore = 80;
    const child = computeInheritedTrust(parentScore, 1);
    expect(child).toBeCloseTo(80 * TRUST_INHERITANCE_FACTOR);
  });

  it('deep spawn has very low trust', () => {
    const score = computeInheritedTrust(80, 3);
    expect(score).toBeLessThan(30);
  });

  it('clamps to 0-100', () => {
    expect(computeInheritedTrust(-10, 1)).toBe(0);
    expect(computeInheritedTrust(200, 0)).toBe(100);
  });
});

describe('Risk Ceiling Cap', () => {
  it('caps autonomous to read-only for READ ceiling', () => {
    expect(capTrustByRiskCeiling('autonomous', 'READ')).toBe('read-only');
  });

  it('caps autonomous to write-with-approvals for WRITE ceiling', () => {
    expect(capTrustByRiskCeiling('autonomous', 'WRITE')).toBe('write-with-approvals');
  });

  it('does not cap for DESTRUCTIVE ceiling', () => {
    expect(capTrustByRiskCeiling('autonomous', 'DESTRUCTIVE')).toBe('autonomous');
  });

  it('passes through when no ceiling', () => {
    expect(capTrustByRiskCeiling('autonomous', undefined)).toBe('autonomous');
  });
});

describe('Cosine Similarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = { exec: 0.8, http: 0.2 };
    expect(cosineSimilarity(a, a)).toBeCloseTo(1);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = { exec: 1, http: 0 };
    const b = { exec: 0, http: 1 };
    expect(cosineSimilarity(a, b)).toBeCloseTo(0);
  });

  it('returns positive for partially overlapping vectors', () => {
    const a = { exec: 0.8, http: 0.2 };
    const b = { exec: 0.5, http: 0.5 };
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.5);
    expect(sim).toBeLessThan(1);
  });
});

describe('Profile Comparison', () => {
  const profileA: AgentProfile = {
    toolMix: { wooblay_exec: 0.8, wooblay_http: 0.2 },
    riskMix: { READ: 0.7, WRITE: 0.3 },
    avgSessionDurationMs: 60000,
    avgToolCallsPerTask: 10,
    avgTimeBetweenCallsMs: 5000,
    approvalRate: 0.1,
    denialRate: 0.05,
    topDomains: ['api.github.com'],
    computedAt: new Date().toISOString(),
    sampleSize: 100,
  };

  it('returns ~1 for identical profiles', () => {
    expect(compareProfiles(profileA, profileA)).toBeGreaterThan(0.95);
  });

  it('returns low similarity for completely different profiles', () => {
    const profileB: AgentProfile = {
      ...profileA,
      toolMix: { wooblay_browser: 1.0 },
      riskMix: { DESTRUCTIVE: 1.0 },
      topDomains: ['evil.com'],
      avgTimeBetweenCallsMs: 500000,
    };
    expect(compareProfiles(profileA, profileB)).toBeLessThan(0.4);
  });
});

describe('Confidence Decay', () => {
  it('returns original confidence for same-day finding', () => {
    const now = new Date();
    expect(decayedConfidence(0.9, now.toISOString(), DEFAULT_DECAY_RATE, now)).toBeCloseTo(0.9);
  });

  it('decays over 7 days', () => {
    const detectedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = decayedConfidence(0.9, detectedAt, DEFAULT_DECAY_RATE);
    expect(result).toBeLessThan(0.9);
    expect(result).toBeGreaterThan(0.5);
  });

  it('CRITICAL findings decay slower', () => {
    const detectedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const normal = decayedConfidence(0.9, detectedAt, DEFAULT_DECAY_RATE);
    const critical = decayedConfidence(0.9, detectedAt, CRITICAL_DECAY_RATE);
    expect(critical).toBeGreaterThan(normal);
  });

  it('is near zero after 60+ days', () => {
    const detectedAt = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const result = decayedConfidence(0.9, detectedAt, DEFAULT_DECAY_RATE);
    expect(result).toBeLessThan(0.1);
  });
});

describe('Trust Penalty Computation', () => {
  it('returns 0 for empty findings', () => {
    expect(computeTrustPenalty([])).toBe(0);
  });

  it('computes penalty for findings', () => {
    const findings: Finding[] = [
      {
        code: 'DESTRUCTIVE_CMD',
        message: 'test',
        evidenceRefs: [],
        confidence: 0.9,
        suggestedAction: 'suspend-agent',
        detectedAt: new Date().toISOString(),
      },
    ];
    const penalty = computeTrustPenalty(findings);
    expect(penalty).toBeGreaterThan(0);
    expect(penalty).toBeLessThan(30);
  });
});
