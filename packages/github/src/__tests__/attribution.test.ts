import { describe, it, expect } from 'vitest';
import { computeAttribution, interventionSummary } from '../attribution.js';
import type { AttributionInput } from '../attribution.js';

describe('computeAttribution', () => {
  it('scores 0 for pure agent PR (no human involvement)', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 100, linesRemoved: 20 },
        { sha: 'a2', authorLogin: 'bot', isAgent: true, linesAdded: 50, linesRemoved: 10 },
      ],
      reviews: [
        { state: 'approved', authorLogin: 'reviewer', submittedAt: '2026-02-10T12:00:00Z' },
      ],
      ciResults: [
        { checkName: 'CI', conclusion: 'success' },
      ],
      revert: { isReverted: false },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(0);
    expect(result.agentCommitShas).toEqual(['a1', 'a2']);
    expect(result.humanCommitShas).toEqual([]);
    expect(result.agentLOC).toBe(180);
    expect(result.humanLOC).toBe(0);
    expect(result.interventionBreakdown.every((f) => !f.triggered)).toBe(true);
  });

  it('scores 1 for human commits below LOC threshold', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 200, linesRemoved: 30 },
        { sha: 'h1', authorLogin: 'human', isAgent: false, linesAdded: 5, linesRemoved: 2 },
      ],
      reviews: [],
      ciResults: [],
      revert: { isReverted: false },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(1);
    expect(result.humanCommitShas).toEqual(['h1']);
    expect(result.humanLOC).toBe(7);
    // Only "human_commits" should be triggered
    const triggered = result.interventionBreakdown.filter((f) => f.triggered);
    expect(triggered).toHaveLength(1);
    expect(triggered[0]!.factor).toBe('human_commits');
  });

  it('scores 2 for human commits above LOC threshold', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 200, linesRemoved: 30 },
        { sha: 'h1', authorLogin: 'human', isAgent: false, linesAdded: 25, linesRemoved: 10 },
      ],
      reviews: [],
      ciResults: [],
      revert: { isReverted: false },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(2);
    expect(result.humanLOC).toBe(35);
    const triggered = result.interventionBreakdown.filter((f) => f.triggered);
    expect(triggered).toHaveLength(2);
    expect(triggered.map((f) => f.factor)).toContain('human_commits');
    expect(triggered.map((f) => f.factor)).toContain('human_loc_threshold');
  });

  it('scores 3 with human commits + changes_requested review', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 100, linesRemoved: 10 },
        { sha: 'h1', authorLogin: 'human', isAgent: false, linesAdded: 30, linesRemoved: 5 },
      ],
      reviews: [
        { state: 'changes_requested', authorLogin: 'reviewer', submittedAt: '2026-02-10T12:00:00Z' },
        { state: 'approved', authorLogin: 'reviewer', submittedAt: '2026-02-10T14:00:00Z' },
      ],
      ciResults: [],
      revert: { isReverted: false },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(3);
    const triggered = result.interventionBreakdown.filter((f) => f.triggered).map((f) => f.factor);
    expect(triggered).toContain('human_commits');
    expect(triggered).toContain('human_loc_threshold');
    expect(triggered).toContain('changes_requested');
  });

  it('scores 4 with human commits + changes_requested + CI failures', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 100, linesRemoved: 10 },
        { sha: 'h1', authorLogin: 'human', isAgent: false, linesAdded: 50, linesRemoved: 20 },
      ],
      reviews: [
        { state: 'changes_requested', authorLogin: 'reviewer', submittedAt: '2026-02-10T12:00:00Z' },
      ],
      ciResults: [
        { checkName: 'CI', conclusion: 'failure' },
        { checkName: 'lint', conclusion: 'failure' },
        { checkName: 'test', conclusion: 'failure' },
      ],
      revert: { isReverted: false },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(4);
  });

  it('scores 5 (maximum) with all factors triggered', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 100, linesRemoved: 10 },
        { sha: 'h1', authorLogin: 'human', isAgent: false, linesAdded: 200, linesRemoved: 50 },
      ],
      reviews: [
        { state: 'changes_requested', authorLogin: 'reviewer', submittedAt: '2026-02-10T12:00:00Z' },
      ],
      ciResults: [
        { checkName: 'CI', conclusion: 'failure' },
        { checkName: 'lint', conclusion: 'failure' },
        { checkName: 'test', conclusion: 'failure' },
      ],
      revert: { isReverted: true, daysSinceRevert: 3 },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(5);
    expect(result.interventionBreakdown.every((f) => f.triggered)).toBe(true);
  });

  it('does not trigger revert if outside window', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'a1', authorLogin: 'bot', isAgent: true, linesAdded: 100, linesRemoved: 10 },
      ],
      reviews: [],
      ciResults: [],
      revert: { isReverted: true, daysSinceRevert: 10 },
    };

    const result = computeAttribution(input);

    const revertFactor = result.interventionBreakdown.find((f) => f.factor === 'reverted');
    expect(revertFactor?.triggered).toBe(false);
  });

  it('respects custom thresholds', () => {
    const input: AttributionInput = {
      commits: [
        { sha: 'h1', authorLogin: 'human', isAgent: false, linesAdded: 15, linesRemoved: 0 },
      ],
      reviews: [],
      ciResults: [
        { checkName: 'CI', conclusion: 'failure' },
      ],
      revert: { isReverted: false },
    };

    // With default threshold (20), 15 LOC is below threshold
    const result1 = computeAttribution(input);
    expect(result1.interventionBreakdown.find((f) => f.factor === 'human_loc_threshold')?.triggered).toBe(false);

    // With lower threshold (10), 15 LOC is above
    const result2 = computeAttribution(input, { humanLOCThreshold: 10 });
    expect(result2.interventionBreakdown.find((f) => f.factor === 'human_loc_threshold')?.triggered).toBe(true);
  });

  it('handles empty commits', () => {
    const input: AttributionInput = {
      commits: [],
      reviews: [],
      ciResults: [],
      revert: { isReverted: false },
    };

    const result = computeAttribution(input);

    expect(result.interventionScore).toBe(0);
    expect(result.agentLOC).toBe(0);
    expect(result.humanLOC).toBe(0);
  });
});

describe('interventionSummary', () => {
  it('returns correct summary for each score range', () => {
    expect(interventionSummary(0)).toContain('no');
    expect(interventionSummary(1)).toContain('Minor');
    expect(interventionSummary(2)).toContain('Minor');
    expect(interventionSummary(3)).toContain('Significant');
    expect(interventionSummary(4)).toContain('Significant');
    expect(interventionSummary(5)).toContain('Heavy');
  });
});
