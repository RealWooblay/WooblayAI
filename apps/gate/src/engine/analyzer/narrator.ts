/**
 * AI Narrator (Layer 2)
 *
 * Produces human-readable summaries and prosecution briefs.
 * Uses a pluggable adapter: API-backed LLM or deterministic template fallback.
 */

import type { Finding, CausalChainNode } from '@wooblay/types';
import type { DetectorContext, CollectedReceipt } from './collector.js';
import { describeToolCall } from '../analysis.js';

// ── Adapter interface ─────────────────────────────────────────────────────────

export interface NarratorInput {
  agentName: string;
  agentPubkey: string;
  trustLevel: string;
  trustScore: number;
  toolCalls: Array<{ toolName: string; args: Record<string, unknown>; riskTier: string }>;
  findings: Finding[];
  receipts: Array<{ hash: string; toolName: string; policyDecision: string; timestamp: string }>;
  mode: 'task' | 'receipt';
  taskId?: string;
}

export interface BriefInput extends NarratorInput {
  causalChain: CausalChainNode[] | null;
  lineage: Array<{ pubkey: string; name: string; trustScore: number }>;
  profileSimilarity: number | null;
}

export interface NarratorAdapter {
  summarize(input: NarratorInput): Promise<string>;
  prosecutionBrief(input: BriefInput): Promise<string>;
}

// ── Template (deterministic) adapter ──────────────────────────────────────────

export class TemplateNarratorAdapter implements NarratorAdapter {
  async summarize(input: NarratorInput): Promise<string> {
    if (input.mode === 'task') {
      return this.taskSummary(input);
    }
    return this.receiptSummary(input);
  }

  async prosecutionBrief(input: BriefInput): Promise<string> {
    return this.templateBrief(input);
  }

  private taskSummary(input: NarratorInput): string {
    const toolBreakdown = Object.entries(
      input.toolCalls.reduce<Record<string, number>>((acc, tc) => {
        acc[tc.toolName] = (acc[tc.toolName] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([tool, count]) => `${count} ${tool.replace('wooblay_', '')}`)
      .join(', ');

    const approvalCount = input.receipts.filter((r) => r.policyDecision === 'APPROVE').length;
    const denyCount = input.receipts.filter((r) => r.policyDecision === 'DENY').length;
    const allowCount = input.receipts.filter((r) => r.policyDecision === 'ALLOW').length;

    const lines = [
      `Goal: ${input.toolCalls.length > 0 ? describeToolCall(input.toolCalls[0].toolName, input.toolCalls[0].args) : 'Unknown'}`,
      `Actions: ${input.toolCalls.length} tool calls (${toolBreakdown})`,
      `Approvals: ${approvalCount} required, ${allowCount} auto-allowed, ${denyCount} denied`,
      `Outcome: ${input.findings.length === 0 ? 'Clean' : `${input.findings.length} finding(s) detected`}`,
      `Trust: ${input.trustLevel} (score ${input.trustScore})`,
    ];

    return lines.join('\n');
  }

  private receiptSummary(input: NarratorInput): string {
    if (input.toolCalls.length === 0) return 'No tool call data available';

    const tc = input.toolCalls[0];
    const receipt = input.receipts[0];
    const action = describeToolCall(tc.toolName, tc.args);

    // Extract target
    const args = tc.args;
    const target = String(args['url'] ?? args['endpoint'] ?? args['command'] ?? args['path'] ?? 'unknown');
    const truncTarget = target.length > 80 ? target.slice(0, 80) + '...' : target;

    const result = receipt
      ? `${receipt.policyDecision}${receipt.policyDecision === 'APPROVE' ? ' (pending approval)' : ''}`
      : 'Pending';

    return [
      `Action: ${action}`,
      `Target: ${truncTarget}`,
      `Result: ${result}`,
    ].join('\n');
  }

  private templateBrief(input: BriefInput): string {
    const lines: string[] = [];

    lines.push('# Prosecution Brief');
    lines.push('');
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(`Agent **${input.agentName}** (${input.agentPubkey.slice(0, 16)}...) triggered ${input.findings.length} CRITICAL finding(s). Trust level: ${input.trustLevel} (score: ${input.trustScore}).`);
    lines.push('');

    lines.push('## Timeline of Events');
    lines.push('');
    for (const receipt of input.receipts) {
      const time = new Date(receipt.timestamp).toLocaleString();
      lines.push(`- **${time}** — ${receipt.toolName}: ${receipt.policyDecision} [${receipt.hash.slice(0, 12)}...]`);
    }
    lines.push('');

    lines.push('## Findings');
    lines.push('');
    for (const finding of input.findings) {
      lines.push(`### ${finding.code} (confidence: ${(finding.confidence * 100).toFixed(0)}%)`);
      lines.push(finding.message);
      lines.push(`- Suggested action: **${finding.suggestedAction}**`);
      lines.push(`- Evidence: ${finding.evidenceRefs.map((r) => r.slice(0, 12) + '...').join(', ')}`);
      lines.push('');
    }

    if (input.causalChain && input.causalChain.length > 0) {
      lines.push('## Causal Chain');
      lines.push('');
      for (const node of input.causalChain) {
        const icon = node.verdict === 'malicious' ? '[X]' : node.verdict === 'suspicious' ? '[!]' : '[ ]';
        lines.push(`${icon} ${node.action} (${node.verdict}) [${node.receiptHash.slice(0, 12)}...]`);
      }
      lines.push('');
    }

    lines.push('## Recommended Actions');
    lines.push('');
    const actions = [...new Set(input.findings.map((f) => f.suggestedAction))];
    for (const action of actions) {
      lines.push(`- ${action}`);
    }

    return lines.join('\n');
  }
}

// ── API (LLM-backed) adapter ──────────────────────────────────────────────────

export class ApiNarratorAdapter implements NarratorAdapter {
  private apiKey: string;
  private model: string;
  private baseUrl: string;
  private fallback: TemplateNarratorAdapter;

  constructor(opts: { apiKey: string; model?: string; baseUrl?: string }) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? 'claude-3-5-haiku-20241022';
    this.baseUrl = opts.baseUrl ?? 'https://api.anthropic.com/v1';
    this.fallback = new TemplateNarratorAdapter();
  }

  async summarize(input: NarratorInput): Promise<string> {
    try {
      const prompt = this.buildSummaryPrompt(input);
      return await this.callLLM(prompt, 300);
    } catch (err) {
      console.error('[narrator] LLM call failed, using template fallback:', err);
      return this.fallback.summarize(input);
    }
  }

  async prosecutionBrief(input: BriefInput): Promise<string> {
    try {
      const prompt = this.buildBriefPrompt(input);
      return await this.callLLM(prompt, 1500);
    } catch (err) {
      console.error('[narrator] LLM brief failed, using template fallback:', err);
      return this.fallback.prosecutionBrief(input);
    }
  }

  private buildSummaryPrompt(input: NarratorInput): string {
    const toolList = input.toolCalls.map((tc) =>
      `- ${tc.toolName} (${tc.riskTier}): ${describeToolCall(tc.toolName, tc.args)}`
    ).join('\n');

    const findingList = input.findings.map((f) =>
      `- ${f.code} (${(f.confidence * 100).toFixed(0)}%): ${f.message}`
    ).join('\n');

    const mode = input.mode === 'task'
      ? 'Produce exactly 5 lines: Goal, Actions, Approvals, Outcome, Rollback availability'
      : 'Produce exactly 3 lines: Action, Target, Result';

    return `You are a security analyst summarizing AI agent activity for an enterprise supervision dashboard.

Agent: ${input.agentName} (${input.agentPubkey.slice(0, 16)}...)
Trust Level: ${input.trustLevel} (score: ${input.trustScore})

Tool Calls:
${toolList || 'None'}

Findings:
${findingList || 'None (clean)'}

${mode}

Be concise, factual, no speculation. Each line should be a single sentence.`;
  }

  private buildBriefPrompt(input: BriefInput): string {
    const timeline = input.receipts.map((r) =>
      `- ${r.timestamp}: ${r.toolName} → ${r.policyDecision} [${r.hash.slice(0, 12)}]`
    ).join('\n');

    const findingList = input.findings.map((f) =>
      `- ${f.code} (${(f.confidence * 100).toFixed(0)}%): ${f.message}\n  Evidence: ${f.evidenceRefs.join(', ')}\n  Suggested: ${f.suggestedAction}`
    ).join('\n');

    const lineageStr = input.lineage.map((a) => `${a.name} (trust:${a.trustScore})`).join(' → ');

    return `You are a security analyst producing an incident report for a CRITICAL finding in an AI agent supervision system.

## Agent Identity
Name: ${input.agentName}, Pubkey: ${input.agentPubkey.slice(0, 16)}...
Trust: ${input.trustLevel} (score: ${input.trustScore})
Lineage: ${lineageStr || 'Root agent (no parent)'}
${input.profileSimilarity !== null ? `Behavioral Profile Match: ${(input.profileSimilarity * 100).toFixed(0)}%` : ''}

## Evidence Chain
${timeline}

## Findings
${findingList}

Produce a structured incident brief with:
1. Executive Summary (2-3 sentences explaining what happened and why it matters)
2. Timeline of Events (chronological, reference receipt hashes)
3. Risk Assessment (impact, likelihood of malicious intent)
4. Recommended Actions (specific, actionable steps)

Use markdown formatting. Be concise and factual.`;
  }

  private async callLLM(prompt: string, maxTokens: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { content: Array<{ text: string }> };
    return data.content[0]?.text ?? '';
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Create a narrator adapter based on environment configuration.
 */
export function createNarrator(): NarratorAdapter {
  const apiKey = process.env['ANALYZER_LLM_API_KEY'];

  if (apiKey) {
    return new ApiNarratorAdapter({
      apiKey,
      model: process.env['ANALYZER_LLM_MODEL'],
      baseUrl: process.env['ANALYZER_LLM_BASE_URL'],
    });
  }

  return new TemplateNarratorAdapter();
}
