/**
 * Causal Chain Reconstruction Tests
 */

import { describe, it, expect } from 'vitest';
import { buildCausalChain } from '../../engine/analyzer/causal.js';
import type { DetectorContext, CollectedToolCall, CollectedReceipt } from '../../engine/analyzer/collector.js';
import type { Finding } from '@wooblay/types';

function makeContext(
  toolCalls: Partial<CollectedToolCall>[],
  receipts: Partial<CollectedReceipt>[],
): DetectorContext {
  return {
    toolCalls: toolCalls.map((tc, i) => ({
      id: `tc-${i}`,
      taskId: 'task-1',
      sessionId: null,
      agentPubkey: 'agent-pub-1',
      toolName: 'wooblay_exec',
      args: '{}',
      parsedArgs: {},
      riskTier: 'READ',
      adapter: null,
      createdAt: new Date(),
      ...tc,
    })),
    receipts: receipts.map((r, i) => ({
      id: `r-${i}`,
      toolCallId: `tc-${i}`,
      agentPubkey: 'agent-pub-1',
      toolName: 'wooblay_exec',
      riskTier: 'READ',
      policyDecision: 'ALLOW',
      policyRuleId: null,
      approvalDecision: null,
      approver: null,
      executionSummary: null,
      decisionTrail: '{}',
      chainPrev: null,
      timestamp: new Date().toISOString(),
      hash: `hash-${i}`,
      createdAt: new Date(),
      ...r,
    })),
    executions: [],
    approvals: [],
    agent: {
      pubkey: 'agent-pub-1',
      name: 'TestAgent',
      status: 'active',
      trustLevel: 'write-with-approvals',
      trustScore: 60,
      parentPubkey: null,
      spawnDepth: 0,
      profile: null,
      spawnScope: null,
      allowlisted: false,
    },
    taskId: 'task-1',
    siblingPubkeys: [],
    siblingToolCalls: [],
  };
}

describe('Causal Chain Builder', () => {
  it('returns null for fewer than 2 findings', () => {
    const ctx = makeContext([], []);
    const chain = buildCausalChain(ctx, [
      {
        code: 'DESTRUCTIVE_CMD',
        message: 'test',
        evidenceRefs: [],
        confidence: 0.9,
        suggestedAction: 'suspend-agent',
        detectedAt: new Date().toISOString(),
      },
    ]);
    expect(chain).toBeNull();
  });

  it('builds chain from denial then bypass', () => {
    const now = Date.now();
    const ctx = makeContext(
      [
        { id: 'tc-0', toolName: 'wooblay_exec', args: JSON.stringify({ command: 'rm -rf /data' }), parsedArgs: { command: 'rm -rf /data' }, createdAt: new Date(now - 120000) },
        { id: 'tc-1', toolName: 'wooblay_exec', args: JSON.stringify({ command: 'rm -rf /data/old' }), parsedArgs: { command: 'rm -rf /data/old' }, createdAt: new Date(now - 60000) },
      ],
      [
        { id: 'r-0', toolCallId: 'tc-0', policyDecision: 'DENY', toolName: 'wooblay_exec', hash: 'hash-0', timestamp: new Date(now - 120000).toISOString(), createdAt: new Date(now - 120000) },
        { id: 'r-1', toolCallId: 'tc-1', policyDecision: 'ALLOW', toolName: 'wooblay_exec', hash: 'hash-1', timestamp: new Date(now - 60000).toISOString(), createdAt: new Date(now - 60000) },
      ],
    );

    const findings: Finding[] = [
      {
        code: 'DESTRUCTIVE_CMD',
        message: 'rm -rf',
        evidenceRefs: ['tc-0', 'r-0'],
        confidence: 1.0,
        suggestedAction: 'suspend-agent',
        detectedAt: new Date().toISOString(),
      },
      {
        code: 'APPROVAL_BYPASS',
        message: 'Mutated retry after denial',
        evidenceRefs: ['r-0', 'tc-1'],
        confidence: 0.85,
        suggestedAction: 'suspend-agent',
        detectedAt: new Date().toISOString(),
      },
    ];

    const chain = buildCausalChain(ctx, findings);
    expect(chain).not.toBeNull();
    expect(chain!.length).toBeGreaterThanOrEqual(2);

    // First node should be the denied receipt
    const deniedNode = chain!.find((n) => n.receiptHash === 'hash-0');
    expect(deniedNode).toBeDefined();
  });
});
