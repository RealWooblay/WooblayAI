/**
 * Agent Router — intelligent operation-to-agent matching.
 *
 * When a sensor creates an Operation, the router:
 * 1. Loads all active agent instances + their routing history
 * 2. Builds rich agent profiles (role, specialization, past performance)
 * 3. AI evaluation (single LLM call):
 *    - Classifies intent from rich event context
 *    - Scores each agent on role match, specialization, complexity fit
 *    - Assesses risk level of the operation
 * 4. Applies confidence thresholds:
 *    - >= 0.7 → auto_routed (assign + auto-create Run)
 *    - >= 0.3 → needs_approval (suggest best match, ask user to confirm)
 *    - < 0.3  → pending (no assignment, user picks manually)
 *
 * The router learns from outcomes: agents with higher success rates on
 * similar operations get boosted in future routing decisions.
 */

import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import { config } from '../config.js';
import { buildRoutingSystemPrompt, buildAgentHistoryContext } from '../prompts/routing.js';

import type { RoutingResult, AgentSummary } from '../types/routing.js';
export type { RoutingResult };

// ── Confidence Thresholds ───────────────────────────────────────────────

const AUTO_ROUTE_THRESHOLD = 0.7;
const APPROVAL_THRESHOLD = 0.3;

// ── Agent History Loader ────────────────────────────────────────────────

interface AgentHistory {
  totalRouted: number;
  completedSuccessfully: number;
  failedOrTimedOut: number;
  avgCompletionMinutes: number | null;
  recentIntents: string[];
}

async function loadAgentHistory(
  prisma: PrismaClient,
  instanceId: string,
): Promise<AgentHistory> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Count operations routed to this agent
  const operations = await prisma.operation.findMany({
    where: {
      instanceId,
      createdAt: { gte: thirtyDaysAgo },
    },
    select: {
      id: true,
      status: true,
      intent: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const totalRouted = operations.length;
  const completedSuccessfully = operations.filter((o) => o.status === 'resolved').length;
  const failedOrTimedOut = operations.filter((o) => o.status === 'closed').length;

  // Calculate avg completion time for resolved operations
  const resolvedOps = operations.filter((o) => o.status === 'resolved');
  let avgCompletionMinutes: number | null = null;
  if (resolvedOps.length > 0) {
    const totalMinutes = resolvedOps.reduce((sum, o) => {
      const diff = new Date(o.updatedAt).getTime() - new Date(o.createdAt).getTime();
      return sum + diff / 60_000;
    }, 0);
    avgCompletionMinutes = totalMinutes / resolvedOps.length;
  }

  // Recent intents (last 10)
  const recentIntents = [...new Set(operations.slice(0, 10).map((o) => o.intent))];

  return { totalRouted, completedSuccessfully, failedOrTimedOut, avgCompletionMinutes, recentIntents };
}

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
  // Load all active instances
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

  // Build agent summaries with history
  const agentSummaries: AgentSummary[] = [];
  for (const inst of instances) {
    const history = await loadAgentHistory(prisma, inst.id);
    agentSummaries.push({
      id: inst.id,
      name: inst.name,
      role: inst.role || inst.inferredRole || 'General purpose agent',
      status: inst.status,
      history,
    });
  }

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
    // Fallback: enhanced keyword/intent matching
    const result = fallbackRouting(operation, agentSummaries);
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
    return fallbackRouting(operation, agents);
  }

  // Parse and format event context
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
${ctx.isReleaseBranch ? '- Is Release Branch: true' : ''}
${ctx.isProtectedBranch ? '- Is Protected Branch: true' : ''}
${ctx.prTitle ? `- PR Title: ${ctx.prTitle}` : ''}
${ctx.prBody ? `- PR Body: ${ctx.prBody.slice(0, 500)}` : ''}
${ctx.labels?.length ? `- Labels: ${ctx.labels.join(', ')}` : ''}
${ctx.requestedReviewers?.length ? `- Requested Reviewers: ${ctx.requestedReviewers.join(', ')}` : ''}
${ctx.checkName ? `- Check Name: ${ctx.checkName}` : ''}
${ctx.checkConclusion ? `- Check Conclusion: ${ctx.checkConclusion}` : ''}
${ctx.checkOutputTitle ? `- Check Output: ${ctx.checkOutputTitle}` : ''}
${ctx.changedFiles ? `- Changed Files: ${ctx.changedFiles}` : ''}
${ctx.additions !== undefined ? `- Additions: +${ctx.additions}` : ''}
${ctx.deletions !== undefined ? `- Deletions: -${ctx.deletions}` : ''}
${ctx.changeSize ? `- Change Size: ${ctx.changeSize}` : ''}
${ctx.riskSignal ? `- Risk Signal: ${ctx.riskSignal}` : ''}
${ctx.forcePush ? '- FORCE PUSH: true' : ''}
${ctx.commitCount ? `- Commit Count: ${ctx.commitCount}` : ''}
${ctx.commitMessages?.length ? `- Recent Commits: ${ctx.commitMessages.slice(0, 3).join('; ')}` : ''}
${ctx.fileList?.length ? `- Files Changed: ${ctx.fileList.slice(0, 20).join(', ')}${ctx.fileList.length > 20 ? ` (+${ctx.fileList.length - 20} more)` : ''}` : ''}
${ctx.mergeableState ? `- Mergeable State: ${ctx.mergeableState}` : ''}`;
    } catch {
      // Ignore parse errors
    }
  }

  // Build agent descriptions with history
  const agentDescriptions = agents.map((a) => {
    let desc = `- ID: ${a.id}, Name: ${a.name}, Role: "${a.role}"`;
    if (a.history && a.history.totalRouted > 0) {
      desc += '\n' + buildAgentHistoryContext(a.history);
    }
    return desc;
  }).join('\n');

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
${agentDescriptions}`;

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
      max_tokens: 800,
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
    riskAssessment: parsed.riskAssessment || undefined,
    suggestedFollowUp: parsed.suggestedFollowUp || null,
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
    eventContext?: string | null;
  },
  agents: AgentSummary[],
): RoutingResult {
  const effectiveIntent = operation.suggestedIntent ?? operation.intent;
  const text = `${operation.title} ${operation.summary ?? ''} ${effectiveIntent} ${operation.repoFullName ?? ''}`.toLowerCase();

  // Parse event context for enhanced fallback matching
  let changeSize: string | undefined;
  let riskSignal: string | undefined;
  if (operation.eventContext) {
    try {
      const ctx = JSON.parse(operation.eventContext);
      changeSize = ctx.changeSize;
      riskSignal = ctx.riskSignal;
    } catch { /* ignore */ }
  }

  let bestMatch: AgentSummary | null = null;
  let bestScore = 0;

  for (const agent of agents) {
    const role = agent.role.toLowerCase();
    let score = 0;

    // Keyword overlap scoring
    const roleWords = role.split(/\s+/);
    for (const word of roleWords) {
      if (word.length > 3 && text.includes(word)) {
        score += 0.15;
      }
    }

    // Intent matching
    if (effectiveIntent === 'fix' && (role.includes('fix') || role.includes('debug') || role.includes('ci'))) score += 0.3;
    if (effectiveIntent === 'qa' && (role.includes('qa') || role.includes('test') || role.includes('quality'))) score += 0.3;
    if (effectiveIntent === 'review' && (role.includes('review') || role.includes('code review'))) score += 0.3;
    if (effectiveIntent === 'deploy' && (role.includes('deploy') || role.includes('devops') || role.includes('infra'))) score += 0.3;

    // History-based boost: agents with higher success rates get a bonus
    if (agent.history && agent.history.totalRouted > 0) {
      const successRate = agent.history.completedSuccessfully / agent.history.totalRouted;
      score += successRate * 0.15;

      // Boost for agents that have handled this intent before
      if (agent.history.recentIntents.includes(effectiveIntent)) {
        score += 0.1;
      }
    }

    // Risk-based adjustment: high-risk operations prefer experienced agents
    if (riskSignal === 'high' && agent.history && agent.history.totalRouted > 5) {
      score += 0.1;
    }

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
    reason: `Best match: ${bestMatch.name} (role: "${bestMatch.role}") — keyword/intent scoring${bestMatch.history && bestMatch.history.totalRouted > 0 ? ` + ${bestMatch.history.totalRouted} ops history` : ''}.`,
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

  if (result.classifiedIntent) {
    updateData.intent = result.classifiedIntent;
  }

  // Store AI-recommended follow-up for later execution when operation resolves
  if (result.suggestedFollowUp) {
    updateData.followUpConfig = JSON.stringify(result.suggestedFollowUp);
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
      riskAssessment: result.riskAssessment,
      suggestedFollowUp: result.suggestedFollowUp,
    },
  });
}
