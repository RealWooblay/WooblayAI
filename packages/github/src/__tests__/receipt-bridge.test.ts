import { describe, it, expect } from 'vitest';
import { computeReceiptCoverage, extractTaskIdFromComment } from '../receipt-bridge.js';
import type { AgentCommitRecord, ReceiptRecord } from '../receipt-bridge.js';

describe('computeReceiptCoverage', () => {
  it('returns 100% coverage when all commits have matching receipts', () => {
    const commits: AgentCommitRecord[] = [
      { sha: 'a1', createdAt: '2026-02-10T10:00:00Z' },
      { sha: 'a2', createdAt: '2026-02-10T10:30:00Z' },
    ];

    const receipts: ReceiptRecord[] = [
      { hash: 'r1', agentPubkey: 'pk1', toolCallId: 'tc1', timestamp: '2026-02-10T10:01:00Z' },
      { hash: 'r2', agentPubkey: 'pk1', toolCallId: 'tc2', timestamp: '2026-02-10T10:29:00Z' },
    ];

    const result = computeReceiptCoverage(commits, receipts);

    expect(result.receiptCoverage).toBe(1.0);
    expect(result.coveredCommits).toBe(2);
    expect(result.totalAgentCommits).toBe(2);
    expect(result.receiptHashes).toEqual(['r1', 'r2']);
  });

  it('returns 50% coverage when half the commits have receipts', () => {
    const commits: AgentCommitRecord[] = [
      { sha: 'a1', createdAt: '2026-02-10T10:00:00Z' },
      { sha: 'a2', createdAt: '2026-02-10T12:00:00Z' },
    ];

    const receipts: ReceiptRecord[] = [
      { hash: 'r1', agentPubkey: 'pk1', toolCallId: 'tc1', timestamp: '2026-02-10T10:02:00Z' },
    ];

    const result = computeReceiptCoverage(commits, receipts);

    expect(result.receiptCoverage).toBe(0.5);
    expect(result.coveredCommits).toBe(1);
    expect(result.totalAgentCommits).toBe(2);
  });

  it('returns 0% coverage when no receipts match', () => {
    const commits: AgentCommitRecord[] = [
      { sha: 'a1', createdAt: '2026-02-10T10:00:00Z' },
    ];

    const receipts: ReceiptRecord[] = [
      { hash: 'r1', agentPubkey: 'pk1', toolCallId: 'tc1', timestamp: '2026-02-10T18:00:00Z' },
    ];

    const result = computeReceiptCoverage(commits, receipts);

    expect(result.receiptCoverage).toBe(0);
    expect(result.coveredCommits).toBe(0);
  });

  it('returns 100% coverage for empty commits (vacuously true)', () => {
    const result = computeReceiptCoverage([], [
      { hash: 'r1', agentPubkey: 'pk1', toolCallId: 'tc1', timestamp: '2026-02-10T10:00:00Z' },
    ]);

    expect(result.receiptCoverage).toBe(1.0);
    expect(result.totalAgentCommits).toBe(0);
  });

  it('respects custom match window', () => {
    const commits: AgentCommitRecord[] = [
      { sha: 'a1', createdAt: '2026-02-10T10:00:00Z' },
    ];

    const receipts: ReceiptRecord[] = [
      // 8 minutes away from commit
      { hash: 'r1', agentPubkey: 'pk1', toolCallId: 'tc1', timestamp: '2026-02-10T10:08:00Z' },
    ];

    // Default window is 5 min — should NOT match
    const result1 = computeReceiptCoverage(commits, receipts);
    expect(result1.receiptCoverage).toBe(0);

    // Custom window of 10 min — should match
    const result2 = computeReceiptCoverage(commits, receipts, { matchWindowMinutes: 10 });
    expect(result2.receiptCoverage).toBe(1.0);
  });
});

describe('extractTaskIdFromComment', () => {
  it('extracts task ID from /wooblay link command', () => {
    expect(extractTaskIdFromComment('/wooblay link task-7890')).toBe('task-7890');
  });

  it('is case-insensitive', () => {
    expect(extractTaskIdFromComment('/Wooblay Link TASK-123')).toBe('TASK-123');
  });

  it('returns undefined for non-command comments', () => {
    expect(extractTaskIdFromComment('Great PR! LGTM.')).toBeUndefined();
  });

  it('extracts from multi-line comments', () => {
    const comment = `Linking to our task tracker:
/wooblay link my-task-id

Let me know if this works.`;
    expect(extractTaskIdFromComment(comment)).toBe('my-task-id');
  });

  it('returns undefined for empty string', () => {
    expect(extractTaskIdFromComment('')).toBeUndefined();
  });
});
