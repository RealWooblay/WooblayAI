/**
 * Wooblay Check Run manager.
 *
 * Creates and updates a "Wooblay Attribution" GitHub Check Run on agent PRs.
 * Shows real-time attribution data directly in GitHub's UI.
 */

import type { Octokit } from 'octokit';
import type { AttributionResult } from './attribution.js';
import { interventionSummary } from './attribution.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CheckRunContext {
  owner: string;
  repo: string;
  headSha: string;
  prNumber: number;
  dashboardUrl?: string;
}

export interface CheckRunAttribution extends AttributionResult {
  receiptCoverage?: number;
  reviewCount: number;
  changesRequestedCount: number;
  ciFailureCount: number;
}

// ── Check Run management ─────────────────────────────────────────────────────

const CHECK_RUN_NAME = 'Wooblay Attribution';

/**
 * Map an intervention score to a GitHub check conclusion.
 *
 *   0      → success   ("Pure agent work, no intervention")
 *   1-2    → neutral   ("Minor human involvement")
 *   3+     → action_required ("Significant human intervention")
 */
function scoreToConclusion(score: number): 'success' | 'neutral' | 'action_required' {
  if (score === 0) return 'success';
  if (score <= 2) return 'neutral';
  return 'action_required';
}

/**
 * Build the markdown summary for the check run output.
 */
function buildSummary(
  attr: CheckRunAttribution,
  ctx: CheckRunContext,
): string {
  const agentAdded = attr.agentCommitShas.length > 0
    ? attr.agentLOC
    : 0;
  const humanAdded = attr.humanCommitShas.length > 0
    ? attr.humanLOC
    : 0;

  const receiptPct =
    attr.receiptCoverage !== undefined
      ? `${Math.round(attr.receiptCoverage * 100)}%`
      : 'N/A';

  const triggeredFactors = attr.interventionBreakdown
    .filter((f) => f.triggered)
    .map((f) => f.detail);

  const factorsText =
    triggeredFactors.length > 0
      ? triggeredFactors.join('; ')
      : 'None';

  const dashboardLink = ctx.dashboardUrl
    ? `\n\n[View full attribution on Wooblay Dashboard](${ctx.dashboardUrl}/github/repos/${ctx.owner}%2F${ctx.repo}/prs/${ctx.prNumber})`
    : '';

  return `## Wooblay Attribution Report

| Metric | Value |
|--------|-------|
| Agent LOC | ${agentAdded} (${attr.agentCommitShas.length} commits) |
| Human LOC | ${humanAdded} (${attr.humanCommitShas.length} commits) |
| Intervention Score | ${attr.interventionScore} / 5 |
| Receipt Coverage | ${receiptPct} |
| Reviews | ${attr.reviewCount} (${attr.changesRequestedCount} changes requested) |
| CI Failures | ${attr.ciFailureCount} |

**Status:** ${interventionSummary(attr.interventionScore)}

**Triggered factors:** ${factorsText}${dashboardLink}`;
}

/**
 * Create a new Wooblay Attribution check run on a PR.
 * Returns the created check run ID.
 */
export async function createCheckRun(
  octokit: Octokit,
  ctx: CheckRunContext,
  attr: CheckRunAttribution,
): Promise<number> {
  const conclusion = scoreToConclusion(attr.interventionScore);
  const summary = buildSummary(attr, ctx);

  const { data } = await octokit.rest.checks.create({
    owner: ctx.owner,
    repo: ctx.repo,
    name: CHECK_RUN_NAME,
    head_sha: ctx.headSha,
    status: 'completed',
    conclusion,
    output: {
      title: `Intervention: ${attr.interventionScore}/5 — ${interventionSummary(attr.interventionScore)}`,
      summary,
    },
  });

  return data.id;
}

/**
 * Update an existing Wooblay Attribution check run.
 */
export async function updateCheckRun(
  octokit: Octokit,
  ctx: CheckRunContext & { checkRunId: number },
  attr: CheckRunAttribution,
): Promise<void> {
  const conclusion = scoreToConclusion(attr.interventionScore);
  const summary = buildSummary(attr, ctx);

  await octokit.rest.checks.update({
    owner: ctx.owner,
    repo: ctx.repo,
    check_run_id: ctx.checkRunId,
    status: 'completed',
    conclusion,
    output: {
      title: `Intervention: ${attr.interventionScore}/5 — ${interventionSummary(attr.interventionScore)}`,
      summary,
    },
  });
}

/**
 * Find an existing Wooblay check run on a commit SHA.
 * Returns the check run ID if found, undefined otherwise.
 */
export async function findCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
): Promise<number | undefined> {
  const { data } = await octokit.rest.checks.listForRef({
    owner,
    repo,
    ref: headSha,
    check_name: CHECK_RUN_NAME,
  });

  return data.check_runs[0]?.id;
}

/**
 * Create or update the Wooblay check run for a PR.
 * Idempotent — finds existing check run first.
 */
export async function upsertCheckRun(
  octokit: Octokit,
  ctx: CheckRunContext,
  attr: CheckRunAttribution,
): Promise<number> {
  const existingId = await findCheckRun(
    octokit,
    ctx.owner,
    ctx.repo,
    ctx.headSha,
  );

  if (existingId) {
    await updateCheckRun(octokit, { ...ctx, checkRunId: existingId }, attr);
    return existingId;
  }

  return createCheckRun(octokit, ctx, attr);
}
