/**
 * Deterministic attribution algorithm.
 *
 * Computes an intervention score (0-5) and detailed breakdown for a PR
 * based on commit authorship, LOC, reviews, CI results, and reverts.
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface CommitAttribution {
  sha: string;
  authorLogin: string;
  isAgent: boolean;
  linesAdded: number;
  linesRemoved: number;
}

export interface PRReview {
  state: string; // "approved", "changes_requested", "commented", "dismissed"
  authorLogin: string;
  submittedAt: string;
}

export interface CIResult {
  checkName: string;
  conclusion: string | null; // "success", "failure", "neutral", "cancelled", etc.
}

export interface RevertSignal {
  /** Whether this PR was reverted (detected via "Revert" PR title or revert commit). */
  isReverted: boolean;
  /** Days since the PR was merged until the revert PR was opened. */
  daysSinceRevert?: number;
}

export interface AttributionInput {
  commits: CommitAttribution[];
  reviews: PRReview[];
  ciResults: CIResult[];
  revert: RevertSignal;
}

export interface InterventionFactor {
  factor: string;
  triggered: boolean;
  detail: string;
}

export interface AttributionResult {
  agentCommitShas: string[];
  humanCommitShas: string[];
  agentLOC: number;
  humanLOC: number;
  interventionScore: number;
  interventionBreakdown: InterventionFactor[];
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface AttributionConfig {
  /** LOC threshold above which human changes are considered significant. Default: 20. */
  humanLOCThreshold: number;
  /** Number of CI failures that triggers the factor. Default: 2. */
  ciFailureThreshold: number;
  /** Window in days to consider a revert relevant. Default: 7. */
  revertWindowDays: number;
}

const DEFAULT_CONFIG: AttributionConfig = {
  humanLOCThreshold: 20,
  ciFailureThreshold: 2,
  revertWindowDays: 7,
};

// ── Algorithm ────────────────────────────────────────────────────────────────

/**
 * Compute the attribution result for a PR.
 *
 * The intervention score is deterministic:
 *   +1 if human commits > 0
 *   +1 if human LOC > threshold (default 20 lines)
 *   +1 if PR had "changes_requested" review at least once
 *   +1 if CI failed > N times (default 2)
 *   +1 if PR was reverted within the window (default 7 days)
 */
export function computeAttribution(
  input: AttributionInput,
  config: Partial<AttributionConfig> = {},
): AttributionResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // ── Commit partition ───────────────────────────────────────────────
  const agentCommitShas: string[] = [];
  const humanCommitShas: string[] = [];
  let agentLOC = 0;
  let humanLOC = 0;

  for (const commit of input.commits) {
    const loc = commit.linesAdded + commit.linesRemoved;
    if (commit.isAgent) {
      agentCommitShas.push(commit.sha);
      agentLOC += loc;
    } else {
      humanCommitShas.push(commit.sha);
      humanLOC += loc;
    }
  }

  // ── Factor evaluation ──────────────────────────────────────────────
  const factors: InterventionFactor[] = [];

  // Factor 1: Human commits present
  const hasHumanCommits = humanCommitShas.length > 0;
  factors.push({
    factor: 'human_commits',
    triggered: hasHumanCommits,
    detail: hasHumanCommits
      ? `${humanCommitShas.length} human commit(s) detected`
      : 'No human commits',
  });

  // Factor 2: Human LOC above threshold
  const humanLOCExceeded = humanLOC > cfg.humanLOCThreshold;
  factors.push({
    factor: 'human_loc_threshold',
    triggered: humanLOCExceeded,
    detail: humanLOCExceeded
      ? `Human LOC (${humanLOC}) exceeds threshold (${cfg.humanLOCThreshold})`
      : `Human LOC (${humanLOC}) within threshold (${cfg.humanLOCThreshold})`,
  });

  // Factor 3: Changes requested in review
  const changesRequested = input.reviews.some(
    (r) => r.state === 'changes_requested',
  );
  factors.push({
    factor: 'changes_requested',
    triggered: changesRequested,
    detail: changesRequested
      ? 'PR received "changes requested" review'
      : 'No "changes requested" reviews',
  });

  // Factor 4: CI failures above threshold
  const ciFailures = input.ciResults.filter(
    (r) => r.conclusion === 'failure',
  ).length;
  const ciExceeded = ciFailures > cfg.ciFailureThreshold;
  factors.push({
    factor: 'ci_failures',
    triggered: ciExceeded,
    detail: ciExceeded
      ? `CI failures (${ciFailures}) exceed threshold (${cfg.ciFailureThreshold})`
      : `CI failures (${ciFailures}) within threshold (${cfg.ciFailureThreshold})`,
  });

  // Factor 5: PR reverted within window
  const revertTriggered =
    input.revert.isReverted &&
    (input.revert.daysSinceRevert === undefined ||
      input.revert.daysSinceRevert <= cfg.revertWindowDays);
  factors.push({
    factor: 'reverted',
    triggered: revertTriggered,
    detail: revertTriggered
      ? `PR was reverted${input.revert.daysSinceRevert !== undefined ? ` after ${input.revert.daysSinceRevert} day(s)` : ''}`
      : 'PR has not been reverted',
  });

  // ── Score ──────────────────────────────────────────────────────────
  const interventionScore = factors.filter((f) => f.triggered).length;

  return {
    agentCommitShas,
    humanCommitShas,
    agentLOC,
    humanLOC,
    interventionScore,
    interventionBreakdown: factors,
  };
}

/**
 * Human-readable summary of the intervention score.
 */
export function interventionSummary(score: number): string {
  if (score === 0) return 'Pure agent work, no human intervention';
  if (score <= 2) return 'Minor human involvement';
  if (score <= 4) return 'Significant human intervention';
  return 'Heavy human intervention — agent work largely superseded';
}
