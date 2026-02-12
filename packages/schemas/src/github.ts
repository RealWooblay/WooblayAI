/**
 * Zod schemas for the GitHub integration API.
 */

import { z } from 'zod';

// ── Detection mode ───────────────────────────────────────────────────────────

export const GitHubDetectionModeSchema = z.enum(['bot', 'label', 'trailer']);

// ── Domain schemas ───────────────────────────────────────────────────────────

export const GitHubInstallationSchema = z.object({
  id: z.string(),
  installationId: z.number().int(),
  accountLogin: z.string(),
  accountType: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GitHubRepoSchema = z.object({
  id: z.string(),
  installationId: z.string(),
  githubId: z.number().int(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  createdAt: z.string(),
});

export const GitHubPRSchema = z.object({
  id: z.string(),
  repoId: z.string(),
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  isAgentPR: z.boolean(),
  agentPubkey: z.string().nullable(),
  detectionMode: GitHubDetectionModeSchema.nullable(),
  authorLogin: z.string(),
  headSha: z.string().nullable(),
  baseBranch: z.string().nullable(),
  headBranch: z.string().nullable(),
  createdAt: z.string(),
  mergedAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const GitHubPREventSchema = z.object({
  id: z.string(),
  prId: z.string(),
  eventType: z.string(),
  actorLogin: z.string(),
  payload: z.string(),
  createdAt: z.string(),
});

export const GitHubCommitSchema = z.object({
  id: z.string(),
  prId: z.string(),
  sha: z.string(),
  authorLogin: z.string(),
  authorEmail: z.string().nullable(),
  message: z.string(),
  isAgent: z.boolean(),
  detectionMode: GitHubDetectionModeSchema.nullable(),
  linesAdded: z.number().int(),
  linesRemoved: z.number().int(),
  createdAt: z.string(),
});

export const GitHubCheckResultSchema = z.object({
  id: z.string(),
  prId: z.string(),
  checkName: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const InterventionFactorSchema = z.object({
  factor: z.string(),
  triggered: z.boolean(),
  detail: z.string(),
});

export const GitHubPRAttributionSchema = z.object({
  id: z.string(),
  prId: z.string(),
  agentPubkey: z.string().nullable(),
  agentCommitShas: z.array(z.string()),
  humanCommitShas: z.array(z.string()),
  agentLOC: z.number().int(),
  humanLOC: z.number().int(),
  interventionScore: z.number().int(),
  interventionBreakdown: z.array(InterventionFactorSchema).nullable(),
  receiptCoverage: z.number().nullable(),
  computedAt: z.string(),
});

export const GitHubTaskLinkSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  prId: z.string(),
  receiptHashes: z.array(z.string()).nullable(),
  createdAt: z.string(),
});

// ── API query schemas ────────────────────────────────────────────────────────

export const GitHubPRListQuerySchema = z.object({
  agentPubkey: z.string().optional(),
  state: z.string().optional(),
  minIntervention: z.coerce.number().int().min(0).max(5).optional(),
  repo: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── API response schemas ─────────────────────────────────────────────────────

export const GitHubAgentStatsSchema = z.object({
  agentPubkey: z.string(),
  totalPRs: z.number().int(),
  mergedPRs: z.number().int(),
  avgInterventionScore: z.number(),
  avgTimeToMergeHours: z.number().nullable(),
  avgReviewCycles: z.number(),
  avgCIFailures: z.number(),
  revertRate: z.number(),
  totalAgentLOC: z.number().int(),
  totalHumanLOC: z.number().int(),
  interventionRate: z.number(),
  avgReceiptCoverage: z.number().nullable(),
});

export const GitHubOrgOverviewWeekSchema = z.object({
  weekStart: z.string(),
  avgScore: z.number(),
  prCount: z.number().int(),
});

export const GitHubOrgOverviewSchema = z.object({
  installationId: z.string(),
  accountLogin: z.string(),
  interventionTrend: z.array(GitHubOrgOverviewWeekSchema),
  topIntervenedPRs: z.array(z.object({
    pr: GitHubPRSchema,
    interventionScore: z.number().int(),
  })),
  agentLeaderboard: z.array(z.object({
    agentPubkey: z.string(),
    agentName: z.string().optional(),
    prCount: z.number().int(),
    avgInterventionScore: z.number(),
    mergeRate: z.number(),
  })),
  avgMetrics: z.object({
    avgInterventionScore: z.number(),
    avgTimeToMergeHours: z.number().nullable(),
    interventionRate: z.number(),
    avgReceiptCoverage: z.number().nullable(),
  }),
});
