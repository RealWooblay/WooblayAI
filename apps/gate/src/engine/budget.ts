/**
 * Budget tracking engine.
 *
 * Tracks per-run and global budget consumption. Provides checks
 * before action execution to ensure budgets aren't exceeded.
 */

import type { PrismaClient } from '@prisma/client';

const DEFAULT_GLOBAL_BUDGET_CENTS = 100_00; // $100 global daily budget

import type { BudgetCheck } from '../types/budget.js';
export type { BudgetCheck };

/** Check if a run has budget remaining before executing an action. */
export async function checkBudget(
  prisma: PrismaClient,
  runId: string,
  estimatedCostCents: number = 0,
): Promise<BudgetCheck> {
  const run = await prisma.run.findUnique({ where: { id: runId } });
  if (!run) {
    return { allowed: false, reason: 'Run not found', runBudgetRemaining: 0, globalBudgetRemaining: 0 };
  }

  const runRemaining = run.budgetCents - run.spentCents;
  if (estimatedCostCents > 0 && runRemaining < estimatedCostCents) {
    return {
      allowed: false,
      reason: `Run budget exceeded: ${run.spentCents}¢ spent of ${run.budgetCents}¢ limit`,
      runBudgetRemaining: runRemaining,
      globalBudgetRemaining: 0,
    };
  }

  // Check global daily budget
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const globalSpent = await prisma.run.aggregate({
    where: { createdAt: { gte: todayStart } },
    _sum: { spentCents: true },
  });

  const globalSpentCents = globalSpent._sum.spentCents ?? 0;
  const globalRemaining = DEFAULT_GLOBAL_BUDGET_CENTS - globalSpentCents;

  if (estimatedCostCents > 0 && globalRemaining < estimatedCostCents) {
    return {
      allowed: false,
      reason: `Global daily budget exceeded: ${globalSpentCents}¢ of ${DEFAULT_GLOBAL_BUDGET_CENTS}¢`,
      runBudgetRemaining: runRemaining,
      globalBudgetRemaining: globalRemaining,
    };
  }

  return {
    allowed: true,
    runBudgetRemaining: runRemaining,
    globalBudgetRemaining: globalRemaining,
  };
}

/** Get budget summary for display. */
export async function getBudgetSummary(
  prisma: PrismaClient,
): Promise<{
  todaySpentCents: number;
  todayLimitCents: number;
  activeRunsBudget: { runId: string; budgetCents: number; spentCents: number }[];
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const globalSpent = await prisma.run.aggregate({
    where: { createdAt: { gte: todayStart } },
    _sum: { spentCents: true },
  });

  const activeRuns = await prisma.run.findMany({
    where: { status: { in: ['running', 'scheduled', 'paused'] } },
    select: { id: true, budgetCents: true, spentCents: true },
  });

  return {
    todaySpentCents: globalSpent._sum.spentCents ?? 0,
    todayLimitCents: DEFAULT_GLOBAL_BUDGET_CENTS,
    activeRunsBudget: activeRuns.map((r) => ({
      runId: r.id,
      budgetCents: r.budgetCents,
      spentCents: r.spentCents,
    })),
  };
}
