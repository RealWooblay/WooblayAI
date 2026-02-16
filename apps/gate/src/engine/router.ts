/**
 * Agent Router — global agent routing intelligence.
 *
 * When a sensor creates an Operation, the router evaluates ALL active
 * agent instances in the organization to find the best match.
 *
 * Routing flow:
 * 1. Load all active instances in the org
 * 2. Build role summaries for each instance
 * 3. AI evaluation (single LLM call) — score each agent 0-1
 * 4. Apply confidence thresholds:
 *    - >= 0.7 → auto_routed (assign + auto-create Run)
 *    - >= 0.3 → needs_approval (suggest best match, ask user to confirm)
 *    - < 0.3  → pending (no assignment, user picks manually)
 */

import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import { config } from '../config.js';

// ── Types ───────────────────────────────────────────────────────────────

export interface RoutingResult {
  instanceId: string | null;
  confidence: number;
  status: 'auto_routed' | 'pending' | 'needs_approval';
  reason: string;
}

interface AgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
}

// ── Confidence Thresholds ───────────────────────────────────────────────

const AUTO_ROUTE_THRESHOLD = 0.7;
const APPROVAL_THRESHOLD = 0.3;

// ── Route an Operation ──────────────────────────────────────────────────

export async function routeOperation(
  prisma: PrismaClient,
  operation: {
    id: string;
    orgId: string | null;
    title: string;
    summary: string | null;
    intent: string;
    source: string;
    repoFullName: string | null;
    branch: string | null;
    prNumber: number | null;
  },
): Promise<RoutingResult> {
  // Load all active instances in this org
  const whereClause: Record<string, unknown> = {
    status: 'running',
  };

  const instances = await prisma.instance.findMany({
    where: whereClause,
    select: {
      id: true,
      name: true,
      role: true,
      inferredRole: true,
      status: true,
    },
  });

  // No active instances — operation stays unassigned
  if (instances.length === 0) {
    const result: RoutingResult = {
      instanceId: null,
      confidence: 0,
      status: 'pending',
      reason: 'No active agents in organization. Start an agent to handle this operation.',
    };

    await applyRouting(prisma, operation.id, result);
    return result;
  }

  // Build agent summaries
  const agentSummaries: AgentSummary[] = instances.map((inst) => ({
    id: inst.id,
    name: inst.name,
    role: inst.role || inst.inferredRole || 'General purpose agent',
    status: inst.status,
  }));

  // If only one agent, auto-assign with moderate confidence
  if (instances.length === 1) {
    const agent = agentSummaries[0]!;
    const result: RoutingResult = {
      instanceId: agent.id,
      confidence: 0.6,
      status: 'needs_approval',
      reason: `Only active agent: ${agent.name}. Role: "${agent.role}".`,
    };

    await applyRouting(prisma, operation.id, result);
    return result;
  }

  // AI evaluation — score all agents
  try {
    const result = await aiEvaluateRouting(operation, agentSummaries);
    await applyRouting(prisma, operation.id, result);
    return result;
  } catch (err: any) {
    // Fallback: no routing, let user decide
    const result: RoutingResult = {
      instanceId: null,
      confidence: 0,
      status: 'pending',
      reason: `AI routing unavailable: ${err.message}. Please assign manually.`,
    };

    await applyRouting(prisma, operation.id, result);
    return result;
  }
}

// ── AI Evaluation ───────────────────────────────────────────────────────

async function aiEvaluateRouting(
  operation: {
    title: string;
    summary: string | null;
    intent: string;
    source: string;
    repoFullName: string | null;
    branch: string | null;
    prNumber: number | null;
  },
  agents: AgentSummary[],
): Promise<RoutingResult> {
  if (!config.OPENAI_API_KEY) {
    // No API key — use simple keyword matching fallback
    return fallbackRouting(operation, agents);
  }

  const systemPrompt = `You are a routing engine for Wooblay, a platform that manages AI coding agents. Given an operation (event from a sensor) and a list of available agents with their roles, score each agent 0-1 on how relevant they are to handle this operation.

Return ONLY valid JSON in this exact format:
{
  "scores": [{"instanceId": "...", "score": 0.85, "reason": "brief reason"}],
  "bestMatch": "instanceId of best match or null",
  "overallReason": "one sentence explaining the routing decision"
}`;

  const userPrompt = `Operation:
- Title: ${operation.title}
- Summary: ${operation.summary || 'N/A'}
- Intent: ${operation.intent}
- Source: ${operation.source}
- Repo: ${operation.repoFullName || 'N/A'}
- Branch: ${operation.branch || 'N/A'}
- PR#: ${operation.prNumber ?? 'N/A'}

Available Agents:
${agents.map((a) => `- ID: ${a.id}, Name: ${a.name}, Role: "${a.role}"`).join('\n')}`;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = (await response.json()) as any;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  // Parse AI response
  const parsed = JSON.parse(content);
  const bestMatchId = parsed.bestMatch;
  const bestScore = parsed.scores?.find((s: any) => s.instanceId === bestMatchId);
  const confidence = bestScore?.score ?? 0;

  let status: RoutingResult['status'];
  if (confidence >= AUTO_ROUTE_THRESHOLD) {
    status = 'auto_routed';
  } else if (confidence >= APPROVAL_THRESHOLD) {
    status = 'needs_approval';
  } else {
    status = 'pending';
  }

  return {
    instanceId: bestMatchId || null,
    confidence,
    status,
    reason: parsed.overallReason || bestScore?.reason || 'AI evaluation completed',
  };
}

// ── Fallback Routing (no LLM) ───────────────────────────────────────────

function fallbackRouting(
  operation: {
    title: string;
    summary: string | null;
    intent: string;
    repoFullName: string | null;
  },
  agents: AgentSummary[],
): RoutingResult {
  const text = `${operation.title} ${operation.summary ?? ''} ${operation.intent} ${operation.repoFullName ?? ''}`.toLowerCase();

  let bestMatch: AgentSummary | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    const role = agent.role.toLowerCase();
    let score = 0;

    // Simple keyword overlap scoring
    const roleWords = role.split(/\s+/);
    for (const word of roleWords) {
      if (word.length > 3 && text.includes(word)) {
        score += 0.15;
      }
    }

    // Intent matching
    if (operation.intent === 'fix' && (role.includes('fix') || role.includes('debug') || role.includes('ci'))) score += 0.3;
    if (operation.intent === 'qa' && (role.includes('qa') || role.includes('test') || role.includes('quality'))) score += 0.3;
    if (operation.intent === 'review' && (role.includes('review') || role.includes('code review'))) score += 0.3;
    if (operation.intent === 'deploy' && (role.includes('deploy') || role.includes('devops') || role.includes('infra'))) score += 0.3;

    score = Math.min(score, 1.0);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = agent;
    }
  }

  if (!bestMatch || bestScore < APPROVAL_THRESHOLD) {
    return {
      instanceId: null,
      confidence: bestScore,
      status: 'pending',
      reason: 'No clear agent match found. Please assign manually.',
    };
  }

  return {
    instanceId: bestMatch.id,
    confidence: bestScore,
    status: bestScore >= AUTO_ROUTE_THRESHOLD ? 'auto_routed' : 'needs_approval',
    reason: `Best match: ${bestMatch.name} (role: "${bestMatch.role}") — keyword/intent scoring.`,
  };
}

// ── Apply Routing to Operation ──────────────────────────────────────────

async function applyRouting(
  prisma: PrismaClient,
  operationId: string,
  result: RoutingResult,
): Promise<void> {
  await prisma.operation.update({
    where: { id: operationId },
    data: {
      instanceId: result.instanceId,
      routingConfidence: result.confidence,
      routingStatus: result.status === 'needs_approval' ? 'pending' : result.status,
      routingReason: result.reason,
    },
  });

  await persistEvent(prisma, {
    type: 'operation.routed',
    data: {
      operationId,
      instanceId: result.instanceId,
      confidence: result.confidence,
      status: result.status === 'needs_approval' ? ('pending' as const) : (result.status as any),
    },
  });
}
