/**
 * Cost Attribution — real spend tracking per run.
 *
 * Records actual costs with attribution:
 * - LLM tokens (input + output, by model)
 * - Compute minutes (container uptime)
 * - API calls (gateway invocations)
 * - Tool-specific costs
 *
 * Without real attribution, "budget" is fake.
 */

import type { PrismaClient } from '@prisma/client';

import type { CostCategory, CostEntry, RunCostSummary } from '../types/budget.js';
export type { CostCategory, CostEntry, RunCostSummary };

// ── Pricing (MVP defaults) ──────────────────────────────────────────────

const LLM_PRICING_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 0.25, output: 1.0 },
  'gpt-4.1-mini': { input: 0.04, output: 0.16 },
  'claude-sonnet-4-20250514': { input: 0.3, output: 1.5 },
  'claude-3-haiku': { input: 0.025, output: 0.125 },
  default: { input: 0.1, output: 0.4 },
};

const COMPUTE_COST_PER_MINUTE_CENTS = 0.5; // $0.005/min
const API_CALL_COST_CENTS = 1; // $0.01 per gateway call

// ── Record Cost ─────────────────────────────────────────────────────────

export async function recordCost(
  prisma: PrismaClient,
  entry: CostEntry,
): Promise<void> {
  await prisma.runCost.create({
    data: {
      runId: entry.runId,
      category: entry.category,
      description: entry.description,
      amountCents: entry.amountCents,
      quantity: entry.quantity ?? null,
      unit: entry.unit ?? null,
      metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
    },
  });

  // Also update the run's spentCents (running total)
  await prisma.run.update({
    where: { id: entry.runId },
    data: { spentCents: { increment: entry.amountCents } },
  });
}

// ── LLM Cost ────────────────────────────────────────────────────────────

export async function recordLLMCost(
  prisma: PrismaClient,
  runId: string,
  data: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    promptId?: string;
  },
): Promise<void> {
  const pricing = LLM_PRICING_PER_1K_TOKENS[data.model] ?? LLM_PRICING_PER_1K_TOKENS.default!;
  const inputCost = (data.inputTokens / 1000) * pricing.input;
  const outputCost = (data.outputTokens / 1000) * pricing.output;
  const totalCents = Math.ceil((inputCost + outputCost) * 100);
  const totalTokens = data.inputTokens + data.outputTokens;

  await recordCost(prisma, {
    runId,
    category: 'llm_tokens',
    description: `${data.model} — ${data.inputTokens} in / ${data.outputTokens} out`,
    amountCents: totalCents,
    quantity: totalTokens,
    unit: 'tokens',
    metadata: {
      model: data.model,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      promptId: data.promptId,
    },
  });
}

// ── Compute Cost ────────────────────────────────────────────────────────

export async function recordComputeCost(
  prisma: PrismaClient,
  runId: string,
  minutes: number,
  containerType?: string,
): Promise<void> {
  const amountCents = Math.ceil(minutes * COMPUTE_COST_PER_MINUTE_CENTS);

  await recordCost(prisma, {
    runId,
    category: 'compute_minutes',
    description: `Compute: ${minutes.toFixed(1)} min${containerType ? ` (${containerType})` : ''}`,
    amountCents,
    quantity: minutes,
    unit: 'minutes',
    metadata: containerType ? { containerType } : undefined,
  });
}

// ── Gateway Call Cost ───────────────────────────────────────────────────

export async function recordGatewayCost(
  prisma: PrismaClient,
  runId: string,
  actionClass: string,
): Promise<void> {
  await recordCost(prisma, {
    runId,
    category: 'gateway_calls',
    description: `Gateway: ${actionClass}`,
    amountCents: API_CALL_COST_CENTS,
    quantity: 1,
    unit: 'calls',
    metadata: { actionClass },
  });
}

// ── Cost Summary ────────────────────────────────────────────────────────

export async function getRunCostSummary(
  prisma: PrismaClient,
  runId: string,
): Promise<RunCostSummary> {
  const costs = await prisma.runCost.findMany({
    where: { runId },
    orderBy: { amountCents: 'desc' },
  });

  const byCategory: Record<string, { totalCents: number; count: number }> = {};
  let totalCents = 0;

  for (const cost of costs) {
    totalCents += cost.amountCents;
    const cat = byCategory[cost.category] ?? { totalCents: 0, count: 0 };
    cat.totalCents += cost.amountCents;
    cat.count += 1;
    byCategory[cost.category] = cat;
  }

  return {
    totalCents,
    byCategory,
    topItems: costs.slice(0, 5).map((c) => ({
      description: c.description ?? c.category,
      amountCents: c.amountCents,
    })),
  };
}
