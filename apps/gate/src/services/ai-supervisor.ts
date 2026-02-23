/**
 * AI Supervisor — LLM-powered analysis for agent behavior.
 *
 * Uses OpenAI to provide intelligent analysis that rule-based heuristics can't:
 *   - Threat assessment: detect obfuscated commands, data exfiltration, social engineering
 *   - Behavioral analysis: agent going off-task, spinning wheels, escalation patterns
 *   - Contribution evaluation: quality/impact of agent work, not just counts
 *   - Session summaries: human-readable briefings of what happened
 *
 * All analysis is async and non-blocking — it enriches data after the fact,
 * never gates real-time tool execution (that's the policy engine's job).
 */

import OpenAI from 'openai';
import { config } from '../config.js';
import {
  buildRoleInferencePrompt,
  buildThreatAssessmentPrompt,
  buildBehaviorAnalysisPrompt,
  buildContributionPrompt,
  buildSessionSummaryPrompt,
} from '../prompts/supervisor.js';

// ── Client ───────────────────────────────────────────────────────────────────

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (!config.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({ apiKey: config.OPENAI_API_KEY });
  }
  return client;
}

export function isAIEnabled(): boolean {
  return !!config.OPENAI_API_KEY;
}

import type { ThreatAssessment, ContributionAssessment, SessionSummary, BehaviorAnalysis, RoleInference } from '../types/supervisor.js';
export type { ThreatAssessment, ContributionAssessment, SessionSummary, BehaviorAnalysis, RoleInference };

/**
 * Infer the agent's role from its recent actions and/or config.
 */
export async function inferRole(
  recentActions: Array<{ toolName: string; args: string; category?: string | null }>,
  configJson?: string | null,
): Promise<RoleInference | null> {
  const ai = getClient();
  if (!ai) return null;
  if (recentActions.length < 3 && !configJson) return null;

  // Try to extract personality from config first
  let configHint = '';
  if (configJson) {
    try {
      const cfg = JSON.parse(configJson);
      const personality = cfg.personality ?? cfg.systemPrompt ?? cfg.role ?? cfg.agentPersonality ?? '';
      if (personality) configHint = `\nAgent config personality: "${String(personality).slice(0, 300)}"`;
    } catch { /* ignore */ }
  }

  const actionList = recentActions.slice(0, 20).map((a, i) => {
    let parsed = '';
    try { parsed = JSON.stringify(JSON.parse(a.args)).slice(0, 100); } catch { parsed = a.args.slice(0, 100); }
    return `${i + 1}. ${a.toolName} [${a.category ?? '?'}]: ${parsed}`;
  }).join('\n');

  try {
    const response = await ai.chat.completions.create({
      model: config.OPENAI_MODEL,
      temperature: 0.1,
      max_tokens: 150,
      messages: [
        {
          role: 'system',
          content: buildRoleInferencePrompt(),
        },
        {
          role: 'user',
          content: `${configHint}\n\nRecent actions:\n${actionList || '(none yet)'}\n\nWhat is this agent's role?`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as RoleInference;
  } catch (err) {
    console.warn('[ai-supervisor] Role inference failed:', err);
    return null;
  }
}

// ── Threat Assessment ────────────────────────────────────────────────────────

export async function assessThreat(
  toolName: string,
  args: Record<string, unknown>,
  riskTier: string,
  recentActions: Array<{ toolName: string; args: string; riskTier: string; category?: string | null }>,
  agentRole?: string | null,
  category?: string | null,
): Promise<ThreatAssessment | null> {
  const ai = getClient();
  if (!ai) return null;

  const recentContext = recentActions.slice(0, 10).map((a, i) => {
    let parsedArgs = '';
    try {
      const parsed = JSON.parse(a.args);
      parsedArgs = JSON.stringify(parsed).slice(0, 200);
    } catch {
      parsedArgs = a.args.slice(0, 200);
    }
    return `${i + 1}. ${a.toolName} [${a.riskTier}] (${a.category ?? '?'}): ${parsedArgs}`;
  }).join('\n');

  // Build context for similar actions (pattern anomaly detection)
  const similarActions = recentActions.filter(a => (a.category ?? '') === (category ?? ''));
  const patternContext = similarActions.length > 2
    ? `\nPATTERN CONTEXT: ${similarActions.length} similar "${category}" actions recently. Check if THIS specific action is anomalous compared to the pattern (unusual values, parameters, targets).`
    : '';

  const argsStr = JSON.stringify(args).slice(0, 1000);
  const roleContext = agentRole ? `\nAGENT ROLE: ${agentRole}` : '';

  try {
    const response = await ai.chat.completions.create({
      model: config.OPENAI_MODEL,
      temperature: 0.1,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: buildThreatAssessmentPrompt(agentRole),
        },
        {
          role: 'user',
          content: `CURRENT ACTION:
Tool: ${toolName}
Risk Tier: ${riskTier}
Category: ${category ?? 'unknown'}
Arguments: ${argsStr}${roleContext}${patternContext}

RECENT ACTIONS (most recent first):
${recentContext || '(no prior actions)'}

Assess this action for threats.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as ThreatAssessment;
  } catch (err) {
    console.warn('[ai-supervisor] Threat assessment failed:', err);
    return null;
  }
}

// ── Behavioral Pattern Analysis (batch) ──────────────────────────────────────

export async function analyzeBehavior(
  agentPubkey: string,
  recentActions: Array<{ toolName: string; args: string; riskTier: string; createdAt: string; status: string; category?: string | null }>,
  agentRole?: string | null,
): Promise<BehaviorAnalysis[]> {
  const ai = getClient();
  if (!ai) return [];
  if (recentActions.length < 3) return [];

  const actionList = recentActions.slice(0, 30).map((a, i) => {
    let parsedArgs = '';
    try {
      const parsed = JSON.parse(a.args);
      parsedArgs = JSON.stringify(parsed).slice(0, 150);
    } catch {
      parsedArgs = a.args.slice(0, 150);
    }
    return `${i + 1}. [${a.createdAt}] ${a.toolName} [${a.riskTier}] (${a.category ?? '?'}) ${a.status} — ${parsedArgs}`;
  }).join('\n');

  const roleContext = agentRole ? `\nAgent's declared role: "${agentRole}". Flag any actions that don't fit this role.` : '';

  try {
    const response = await ai.chat.completions.create({
      model: config.OPENAI_MODEL,
      temperature: 0.1,
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: buildBehaviorAnalysisPrompt(),
        },
        {
          role: 'user',
          content: `Agent: ${agentPubkey.slice(0, 16)}...${roleContext}

Actions (chronological):
${actionList}

Analyze for behavioral anomalies.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    return JSON.parse(jsonMatch[0]) as BehaviorAnalysis[];
  } catch (err) {
    console.warn('[ai-supervisor] Behavior analysis failed:', err);
    return [];
  }
}

// ── Contribution Assessment ──────────────────────────────────────────────────

export async function assessContributions(
  actions: Array<{ toolName: string; args: string; status: string; createdAt: string }>,
  instanceName?: string,
): Promise<ContributionAssessment | null> {
  const ai = getClient();
  if (!ai) return null;
  if (actions.length === 0) return null;

  const actionList = actions.slice(0, 40).map((a, i) => {
    let parsedArgs = '';
    try {
      const parsed = JSON.parse(a.args);
      parsedArgs = JSON.stringify(parsed).slice(0, 150);
    } catch {
      parsedArgs = a.args.slice(0, 150);
    }
    return `${i + 1}. ${a.toolName} [${a.status}] — ${parsedArgs}`;
  }).join('\n');

  try {
    const response = await ai.chat.completions.create({
      model: config.OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: buildContributionPrompt(),
        },
        {
          role: 'user',
          content: `${instanceName ? `Instance: ${instanceName}\n` : ''}Actions (${actions.length} total, showing up to 40):
${actionList}

Evaluate this agent's contributions.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as ContributionAssessment;
  } catch (err) {
    console.warn('[ai-supervisor] Contribution assessment failed:', err);
    return null;
  }
}

// ── Session Summary ──────────────────────────────────────────────────────────

export async function summarizeSession(
  events: Array<{
    toolName: string;
    description: string;
    riskTier: string;
    status: string;
    timestamp: string;
  }>,
): Promise<SessionSummary | null> {
  const ai = getClient();
  if (!ai) return null;
  if (events.length === 0) return null;

  const eventList = events.slice(0, 50).map((e, i) =>
    `${i + 1}. [${e.timestamp}] ${e.description} [${e.riskTier}] → ${e.status}`,
  ).join('\n');

  try {
    const response = await ai.chat.completions.create({
      model: config.OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: buildSessionSummaryPrompt(),
        },
        {
          role: 'user',
          content: `Session events (${events.length} total):
${eventList}

Summarize this session.`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    return JSON.parse(jsonMatch[0]) as SessionSummary;
  } catch (err) {
    console.warn('[ai-supervisor] Session summary failed:', err);
    return null;
  }
}
