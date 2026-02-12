/**
 * Narrator Tests
 *
 * Tests deterministic template narrator (no LLM dependency).
 */

import { describe, it, expect } from 'vitest';
import { TemplateNarratorAdapter } from '../../engine/analyzer/narrator.js';
import type { NarratorInput, BriefInput } from '../../engine/analyzer/narrator.js';

const narrator = new TemplateNarratorAdapter();

describe('TemplateNarratorAdapter', () => {
  const baseInput: NarratorInput = {
    agentName: 'TestAgent',
    agentPubkey: 'abc123def456',
    trustLevel: 'write-with-approvals',
    trustScore: 60,
    toolCalls: [
      { toolName: 'wooblay_exec', args: { command: 'ls -la /tmp' }, riskTier: 'READ' },
      { toolName: 'wooblay_exec', args: { command: 'npm install' }, riskTier: 'WRITE' },
    ],
    findings: [],
    receipts: [
      { hash: 'hash1', toolName: 'wooblay_exec', policyDecision: 'ALLOW', timestamp: new Date().toISOString() },
    ],
    mode: 'task',
  };

  it('generates task summary with 5 lines', async () => {
    const summary = await narrator.summarize(baseInput);
    const lines = summary.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(5);
    expect(lines[0]).toContain('Goal:');
    expect(lines[1]).toContain('Actions:');
    expect(lines[2]).toContain('Approvals:');
    expect(lines[3]).toContain('Outcome:');
    expect(lines[4]).toContain('Trust:');
  });

  it('generates receipt summary with 3 lines', async () => {
    const receiptInput: NarratorInput = {
      ...baseInput,
      mode: 'receipt',
    };

    const summary = await narrator.summarize(receiptInput);
    const lines = summary.split('\n').filter((l) => l.trim());
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('Action:');
    expect(lines[1]).toContain('Target:');
    expect(lines[2]).toContain('Result:');
  });

  it('generates prosecution brief for CRITICAL', async () => {
    const briefInput: BriefInput = {
      ...baseInput,
      findings: [
        {
          code: 'CANARY_TRIP',
          message: 'Honeypot triggered',
          evidenceRefs: ['tc-1'],
          confidence: 1.0,
          suggestedAction: 'suspend-agent',
          detectedAt: new Date().toISOString(),
        },
      ],
      causalChain: null,
      lineage: [{ pubkey: 'abc123', name: 'TestAgent', trustScore: 60 }],
      profileSimilarity: 0.8,
    };

    const brief = await narrator.prosecutionBrief(briefInput);
    expect(brief).toContain('Prosecution Brief');
    expect(brief).toContain('Executive Summary');
    expect(brief).toContain('CANARY_TRIP');
    expect(brief).toContain('suspend-agent');
  });
});
