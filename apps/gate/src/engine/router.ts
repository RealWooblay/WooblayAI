/**
 * Agent Router — global agent routing intelligence.
 *
 * When a sensor creates an Operation, the router:
 * 1. Classifies the INTENT dynamically from rich event context
 *    (not hardcoded by the sensor — sensors only suggest)
 * 2. Evaluates ALL active agent instances to find the best match
 * 3. Routes based on agent roles + event context
 *
 * Routing flow:
 * 1. Load all active instances in the org
 * 2. Build role summaries for each instance
 * 3. AI evaluation (single LLM call):
 *    - Classify the intent from event context + agent capabilities
 *    - Score each agent 0-1 on relevance
 * 4. Apply confidence thresholds:
 *    - >= 0.7 → auto_routed (assign + auto-create Run)
 *    - >= 0.3 → needs_approval (suggest best match, ask user to confirm)
 *    - < 0.3  → pending (no assignment, user picks manually)
 */

import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import { config } from '../config.js';
import { buildRoutingSystemPrompt } from '../prompts/routing.js';

import type { RoutingResult, AgentSummary } from '../types/routing.js';
export type { RoutingResult };

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
    suggestedIntent?: string | null;
    eventContext?: string | null;
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
    suggestedIntent?: string | null;
    eventContext?: string | null;
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

  // Parse event context if available
  let eventContextStr = '';
  if (operation.eventContext) {
    try {
      const ctx = JSON.parse(operation.eventContext);
      eventContextStr = `
Event Context:
- Event Type: ${ctx.eventType}
- Action: ${ctx.action}
- Author: ${ctx.author} (${ctx.authorType})
- Is Default Branch: ${ctx.isDefaultBranch}
- Is Agent Branch: ${ctx.isAgentBranch}
${ctx.prTitle ? `- PR Title: ${ctx.prTitle}` : ''}
${ctx.prBody ? `- PR Body: ${ctx.prBody.slice(0, 500)}` : ''}
${ctx.checkName ? `- Check Name: ${ctx.checkName}` : ''}
${ctx.checkConclusion ? `- Check Conclusion: ${ctx.checkConclusion}` : ''}
${ctx.changedFiles ? `- Changed Files: ${ctx.changedFiles}` : ''}
${ctx.commitCount ? `- Commit Count: ${ctx.commitCount}` : ''}
${ctx.commitMessages?.length ? `- Recent Commits: ${ctx.commitMessages.slice(0, 3).join('; ')}` : ''}`;
    } catch {
      // Ignore parse errors
    }
  }

  const systemPrompt = buildRoutingSystemPrompt();

  const userPrompt = `Operation:
- Title: ${operation.title}
- Summary: ${operation.summary || 'N/A'}
- Sensor Suggested Intent: ${operation.suggestedIntent || operation.intent}
- Source: ${operation.source}
- Repo: ${operation.repoFullName || 'N/A'}
- Branch: ${operation.branch || 'N/A'}
- PR#: ${operation.prNumber ?? 'N/A'}
${eventContextStr}

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
    classifiedIntent: parsed.classifiedIntent || undefined,
  };
}

// ── Fallback Routing (no LLM) ───────────────────────────────────────────

function fallbackRouting(
  operation: {
    title: string;
    summary: string | null;
    intent: string;
    suggestedIntent?: string | null;
    repoFullName: string | null;
  },
  agents: AgentSummary[],
): RoutingResult {
  // Fallback intent classification: use suggested intent or derive from keywords
  const effectiveIntent = operation.suggestedIntent ?? operation.intent;
  const text = `${operation.title} ${operation.summary ?? ''} ${effectiveIntent} ${operation.repoFullName ?? ''}`.toLowerCase();

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

    // Intent matching (using effective intent, not hardcoded)
    if (effectiveIntent === 'fix' && (role.includes('fix') || role.includes('debug') || role.includes('ci'))) score += 0.3;
    if (effectiveIntent === 'qa' && (role.includes('qa') || role.includes('test') || role.includes('quality'))) score += 0.3;
    if (effectiveIntent === 'review' && (role.includes('review') || role.includes('code review'))) score += 0.3;
    if (effectiveIntent === 'deploy' && (role.includes('deploy') || role.includes('devops') || role.includes('infra'))) score += 0.3;

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
      classifiedIntent: effectiveIntent !== 'pending_classification' ? effectiveIntent : undefined,
    };
  }

  return {
    instanceId: bestMatch.id,
    confidence: bestScore,
    status: bestScore >= AUTO_ROUTE_THRESHOLD ? 'auto_routed' : 'needs_approval',
    reason: `Best match: ${bestMatch.name} (role: "${bestMatch.role}") — keyword/intent scoring.`,
    classifiedIntent: effectiveIntent !== 'pending_classification' ? effectiveIntent : undefined,
  };
}

// ── Apply Routing to Operation ──────────────────────────────────────────

async function applyRouting(
  prisma: PrismaClient,
  operationId: string,
  result: RoutingResult,
): Promise<void> {
  const updateData: Record<string, unknown> = {
    instanceId: result.instanceId,
    routingConfidence: result.confidence,
    routingStatus: result.status === 'needs_approval' ? 'pending' : result.status,
    routingReason: result.reason,
  };

  // If the AI classified the intent, update it (replacing 'pending_classification')
  if (result.classifiedIntent) {
    updateData.intent = result.classifiedIntent;
  }

  await prisma.operation.update({
    where: { id: operationId },
    data: updateData,
  });

  await persistEvent(prisma, {
    type: 'operation.routed',
    data: {
      operationId,
      instanceId: result.instanceId,
      confidence: result.confidence,
      status: result.status === 'needs_approval' ? ('pending' as const) : (result.status as any),
      classifiedIntent: result.classifiedIntent,
    },
  });
}
