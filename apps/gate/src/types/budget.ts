/** Budget and cost attribution types. */

export interface BudgetCheck {
  allowed: boolean;
  reason?: string;
  runBudgetRemaining: number;
  globalBudgetRemaining: number;
}

export type CostCategory = 'llm_tokens' | 'compute_minutes' | 'api_calls' | 'gateway_calls';

export interface CostEntry {
  runId: string;
  category: CostCategory;
  description: string;
  amountCents: number;
  quantity?: number;
  unit?: string;
  metadata?: Record<string, unknown>;
}

export interface CostSummary {
  totalCost: number;
  costToday: number;
  costThisWeek: number;
  burnRatePerHour: number;
  actionCount: number;
}

export interface RunCostSummary {
  totalCents: number;
  byCategory: Record<string, { totalCents: number; count: number }>;
  topItems: { description: string; amountCents: number }[];
}
