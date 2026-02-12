/**
 * GitHub integration domain types.
 *
 * Models for the GitHub App: installations, repos, PRs, commits,
 * events, check results, attribution, and task links.
 */

// ── Detection ────────────────────────────────────────────────────────────────

export type GitHubDetectionMode = 'bot' | 'label' | 'trailer';

// ── Installations ────────────────────────────────────────────────────────────

export interface GitHubInstallation {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string; // "Organization" | "User"
  status: string;
  createdAt: string;
  updatedAt: string;
}

// ── Repos ────────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: string;
  installationId: string;
  githubId: number;
  owner: string;
  name: string;
  fullName: string;
  createdAt: string;
}

// ── Pull Requests ────────────────────────────────────────────────────────────

export interface GitHubPR {
  id: string;
  repoId: string;
  number: number;
  title: string;
  state: string; // "open" | "closed" | "merged"
  isAgentPR: boolean;
  agentPubkey: string | null;
  detectionMode: GitHubDetectionMode | null;
  authorLogin: string;
  headSha: string | null;
  baseBranch: string | null;
  headBranch: string | null;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
}

// ── PR Events ────────────────────────────────────────────────────────────────

export interface GitHubPREvent {
  id: string;
  prId: string;
  eventType: string; // "review" | "comment" | "push" | "check_run" | "workflow_run"
  actorLogin: string;
  payload: string; // JSON
  createdAt: string;
}

// ── Commits ──────────────────────────────────────────────────────────────────

export interface GitHubCommit {
  id: string;
  prId: string;
  sha: string;
  authorLogin: string;
  authorEmail: string | null;
  message: string;
  isAgent: boolean;
  detectionMode: GitHubDetectionMode | null;
  linesAdded: number;
  linesRemoved: number;
  createdAt: string;
}

// ── Check Results ────────────────────────────────────────────────────────────

export interface GitHubCheckResult {
  id: string;
  prId: string;
  checkName: string;
  status: string; // "queued" | "in_progress" | "completed"
  conclusion: string | null; // "success" | "failure" | "neutral" | "cancelled" | "timed_out" | "action_required" | "skipped"
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ── Attribution ──────────────────────────────────────────────────────────────

export interface InterventionFactor {
  factor: string;
  triggered: boolean;
  detail: string;
}

export interface GitHubPRAttribution {
  id: string;
  prId: string;
  agentPubkey: string | null;
  agentCommitShas: string[];  // stored as JSON in DB
  humanCommitShas: string[];  // stored as JSON in DB
  agentLOC: number;
  humanLOC: number;
  interventionScore: number;
  interventionBreakdown: InterventionFactor[] | null; // stored as JSON in DB
  receiptCoverage: number | null;
  computedAt: string;
}

// ── Task Links ───────────────────────────────────────────────────────────────

export interface GitHubTaskLink {
  id: string;
  taskId: string;
  prId: string;
  receiptHashes: string[] | null; // stored as JSON in DB
  createdAt: string;
}

// ── API Response Types ───────────────────────────────────────────────────────

export interface GitHubPRAttributionResponse {
  pr: GitHubPR;
  attribution: GitHubPRAttribution | null;
  commits: GitHubCommit[];
  events: GitHubPREvent[];
  checkResults: GitHubCheckResult[];
  taskLinks: GitHubTaskLink[];
  metrics: {
    timeToMergeHours: number | null;
    reviewCycles: number;
    ciFailureCount: number;
  };
}

export interface GitHubAgentStats {
  agentPubkey: string;
  totalPRs: number;
  mergedPRs: number;
  avgInterventionScore: number;
  avgTimeToMergeHours: number | null;
  avgReviewCycles: number;
  avgCIFailures: number;
  revertRate: number;
  totalAgentLOC: number;
  totalHumanLOC: number;
  interventionRate: number; // fraction of PRs with interventionScore > 0
  avgReceiptCoverage: number | null;
}

export interface GitHubOrgOverview {
  installationId: string;
  accountLogin: string;
  interventionTrend: Array<{
    weekStart: string;
    avgScore: number;
    prCount: number;
  }>;
  topIntervenedPRs: Array<{
    pr: GitHubPR;
    interventionScore: number;
  }>;
  agentLeaderboard: Array<{
    agentPubkey: string;
    agentName?: string;
    prCount: number;
    avgInterventionScore: number;
    mergeRate: number;
  }>;
  avgMetrics: {
    avgInterventionScore: number;
    avgTimeToMergeHours: number | null;
    interventionRate: number;
    avgReceiptCoverage: number | null;
  };
}

export interface GitHubPRListFilters {
  agentPubkey?: string;
  state?: string;
  minIntervention?: number;
  repo?: string;
  page?: number;
  pageSize?: number;
}

export interface GitHubPRListResponse {
  data: Array<GitHubPR & { attribution: GitHubPRAttribution | null; repoFullName: string }>;
  total: number;
  page: number;
  pageSize: number;
}
