/**
 * Cost estimation engine.
 *
 * Estimates API token cost per tool call based on heuristics.
 * Not exact — provides directional guidance for budget awareness.
 */

import type { PrismaClient } from '@prisma/client';
import type { CostSummary } from '../types/budget.js';
export type { CostSummary };

/** Estimate cost for a single tool call. */
export function estimateToolCallCost(
  toolName: string,
  args: string,
): number {
  const tool = toolName.replace(/^(gated_|wooblay_)/, '');

  switch (tool) {
    case 'exec':
      return 0.001; // minimal — shell command
    case 'write': {
      const chars = args.length;
      return 0.001 + (chars / 1000) * 0.002; // base + $0.002 per 1K chars
    }
    case 'edit': {
      const chars = args.length;
      return 0.001 + (chars / 1000) * 0.002;
    }
    case 'web_fetch':
    case 'http':
      return 0.005; // HTTP requests typically involve some token processing
    case 'web_search':
      return 0.01; // search involves more processing
    case 'read':
      return 0.001; // minimal
    case 'browser':
      return 0.02; // browser automation is heavier
    default:
      return 0.002; // fallback
  }
}

/** Agent turn cost estimate (the LLM inference cost, not tool cost). */
export function estimateAgentTurnCost(model: string): number {
  const m = model.toLowerCase();
  if (m.includes('opus')) return 0.15;
  if (m.includes('sonnet')) return 0.03;
  if (m.includes('haiku')) return 0.005;
  if (m.includes('gpt-4')) return 0.06;
  if (m.includes('gpt-3')) return 0.002;
  return 0.03; // default: Sonnet-class
}

/** Compute cost summary for a given agent or instance. */
export async function computeCostSummary(
  prisma: PrismaClient,
  filter: { agentPubkey?: string; instanceId?: string },
): Promise<CostSummary> {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfWeek = new Date(startOfDay.getTime() - startOfDay.getDay() * 24 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  // Build where clause
  const where: Record<string, unknown> = {};
  if (filter.agentPubkey) where.agentPubkey = filter.agentPubkey;

  // Get all tool calls
  const allCalls = await prisma.toolCall.findMany({
    where,
    select: { toolName: true, args: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  let totalCost = 0;
  let costToday = 0;
  let costThisWeek = 0;
  let recentHourCost = 0;

  for (const call of allCalls) {
    const cost = estimateToolCallCost(call.toolName, call.args) + estimateAgentTurnCost('sonnet');

    totalCost += cost;
    if (call.createdAt >= startOfDay) costToday += cost;
    if (call.createdAt >= startOfWeek) costThisWeek += cost;
    if (call.createdAt >= oneHourAgo) recentHourCost += cost;
  }

  return {
    totalCost: Math.round(totalCost * 1000) / 1000,
    costToday: Math.round(costToday * 1000) / 1000,
    costThisWeek: Math.round(costThisWeek * 1000) / 1000,
    burnRatePerHour: Math.round(recentHourCost * 1000) / 1000,
    actionCount: allCalls.length,
  };
}
