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

export interface ContributionSummary {
  filesCreated: number;
  filesEdited: number;
  commandsExecuted: number;
  linesWritten: number;
  prsAndCommits: number;
  researchActions: number;
  approvalEfficiency: string;
  denialRate: string;
  totalActions: number;
}

export interface ContributionsByCategory {
  planning: number;
  executing: number;
  blocked: number;
}

export interface ContributionResult {
  summary: ContributionSummary;
  byCategory: ContributionsByCategory;
  byDay: Array<{ date: string; count: number }>;
  aiAssessment?: import('./supervisor.js').ContributionAssessment | null;
}
