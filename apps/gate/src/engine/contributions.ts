/**
 * Tool-agnostic org-wide contribution tracking.
 *
 * Aggregates actions by agent, user, tool, outcome, cost, and time period.
 * No dev-centric metrics (files, PRs, lines of code) — this is for any
 * MCP tool: Salesforce, Stripe, Slack, databases, custom servers.
 */

import type { PrismaClient } from '@prisma/client';

export interface ContributionFilters {
  period: 'day' | 'week' | 'month';
  groupBy: 'agent' | 'user' | 'tool';
}

export interface AgentContribution {
  agentId: string;
  agentLabel: string | null;
  userId: string | null;
  totalActions: number;
  allowed: number;
  denied: number;
  approved: number;
  byTool: Record<string, number>;
  estimatedCost: number;
}

export interface OrgContributions {
  period: string;
  periodStart: string;
  periodEnd: string;
  totalActions: number;
  totalAgents: number;
  totalUsers: number;
  autoAllowRate: number;
  byAgent: AgentContribution[];
  byTool: Record<string, number>;
  topDenied: { tool: string; count: number }[];
  byDay: { date: string; count: number }[];
}

function getPeriodRange(period: 'day' | 'week' | 'month'): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  switch (period) {
    case 'day':
      start.setTime(end.getTime() - 24 * 60 * 60 * 1000);
      break;
    case 'week':
      start.setTime(end.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'month':
      start.setTime(end.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
  }
  return { start, end };
}

export async function computeOrgContributions(
  prisma: PrismaClient,
  orgId: string,
  filters: ContributionFilters,
): Promise<OrgContributions> {
  const { start, end } = getPeriodRange(filters.period);

  // Resolve org-scoped agent pubkeys via API keys
  const orgKeys = await prisma.apiKey.findMany({
    where: { orgId, revokedAt: null },
    select: { id: true, label: true, userId: true },
  });
  const orgPubkeys = orgKeys.map((k) => `apikey:${k.id}`);

  const toolCalls = await prisma.toolCall.findMany({
    where: {
      createdAt: { gte: start, lte: end },
      ...(orgPubkeys.length > 0 ? { agentPubkey: { in: orgPubkeys } } : {}),
    },
    include: {
      receipt: { select: { policyDecision: true, approvalDecision: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Resolve API key metadata for agent identity
  const agentPubkeys = [...new Set(toolCalls.map((tc) => tc.agentPubkey))];
  const apiKeyIds = agentPubkeys
    .filter((pk) => pk.startsWith('apikey:'))
    .map((pk) => pk.replace('apikey:', ''));

  const apiKeys = apiKeyIds.length > 0
    ? await prisma.apiKey.findMany({
        where: { id: { in: apiKeyIds }, orgId },
        select: { id: true, label: true, userId: true },
      })
    : [];

  const keyMap = new Map(apiKeys.map((k) => [`apikey:${k.id}`, k]));

  // Aggregate by agent
  const agentMap = new Map<string, AgentContribution>();
  const toolCounts = new Map<string, number>();
  const deniedTools = new Map<string, number>();
  const dayMap = new Map<string, number>();

  for (const tc of toolCalls) {
    const day = tc.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);

    const key = keyMap.get(tc.agentPubkey);
    const agentId = tc.agentPubkey;

    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, {
        agentId,
        agentLabel: key?.label ?? null,
        userId: key?.userId ?? null,
        totalActions: 0,
        allowed: 0,
        denied: 0,
        approved: 0,
        byTool: {},
        estimatedCost: 0,
      });
    }

    const agent = agentMap.get(agentId)!;
    agent.totalActions++;
    agent.byTool[tc.toolName] = (agent.byTool[tc.toolName] ?? 0) + 1;

    toolCounts.set(tc.toolName, (toolCounts.get(tc.toolName) ?? 0) + 1);

    const decision = tc.receipt?.policyDecision;
    const approval = tc.receipt?.approvalDecision;

    if (decision === 'DENY' || approval === 'DENIED') {
      agent.denied++;
      deniedTools.set(tc.toolName, (deniedTools.get(tc.toolName) ?? 0) + 1);
    } else if (decision === 'ALLOW') {
      agent.allowed++;
    } else if (approval === 'APPROVED') {
      agent.approved++;
    }
  }

  // Merge cost data from RunCost if available (using amountCents)
  try {
    const costs = await prisma.runCost.findMany({
      where: { orgId, createdAt: { gte: start, lte: end } },
      select: { amountCents: true },
    });

    const totalCostCents = costs.reduce((s, c) => s + c.amountCents, 0);
    // Distribute cost evenly across agents (best approximation without direct linkage)
    if (agentMap.size > 0 && totalCostCents > 0) {
      const perAgent = totalCostCents / 100 / agentMap.size;
      for (const agent of agentMap.values()) {
        agent.estimatedCost = perAgent;
      }
    }
  } catch {
    // RunCost may not exist or have data
  }

  const totalActions = toolCalls.length;
  const totalAllowed = [...agentMap.values()].reduce((s, a) => s + a.allowed, 0);
  const uniqueUsers = new Set([...agentMap.values()].map((a) => a.userId).filter(Boolean));

  // By day
  const byDay: { date: string; count: number }[] = [];
  const now = new Date();
  const daysInPeriod = filters.period === 'day' ? 1 : filters.period === 'week' ? 7 : 30;
  for (let i = daysInPeriod - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    byDay.push({ date: key, count: dayMap.get(key) ?? 0 });
  }

  // Top denied tools
  const topDenied = [...deniedTools.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tool, count]) => ({ tool, count }));

  return {
    period: filters.period,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    totalActions,
    totalAgents: agentMap.size,
    totalUsers: uniqueUsers.size,
    autoAllowRate: totalActions > 0 ? (totalAllowed / totalActions) * 100 : 0,
    byAgent: [...agentMap.values()].sort((a, b) => b.totalActions - a.totalActions),
    byTool: Object.fromEntries([...toolCounts.entries()].sort(([, a], [, b]) => b - a)),
    topDenied,
    byDay,
  };
}
