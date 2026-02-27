/** Trust scoring and contribution analytics types. */

export interface TrustBreakdown {
  score: number;
  base: number;
  approvedBonus: number;
  autoAllowedBonus: number;
  deniedPenalty: number;
  criticalFlagPenalty: number;
  highFlagPenalty: number;
  totalActions: number;
}

export interface TrustResult {
  score: number;
  breakdown: TrustBreakdown;
  trend: 'up' | 'down' | 'stable';
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
