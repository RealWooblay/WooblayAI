/**
 * Agent detection — identifies whether a PR or commit is agent-authored.
 *
 * Three detection modes, evaluated in priority order (trailer > label > bot):
 *
 * (a) Commit trailer: `Wooblay-Agent-Pubkey: <pubkey>` in commit message
 * (b) PR label: `wooblay-agent:<agentPubkey>` on the PR
 * (c) Bot identity: PR author is a bot account (type "Bot" or login ends with "[bot]")
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type DetectionMode = 'bot' | 'label' | 'trailer';

export interface AgentDetectionResult {
  isAgent: boolean;
  agentPubkey?: string;
  detectionMode?: DetectionMode;
  taskId?: string;
}

export interface CommitInfo {
  sha: string;
  message: string;
  authorLogin: string;
  authorEmail?: string;
  authorType?: string; // "User" | "Bot"
}

export interface PRInfo {
  authorLogin: string;
  authorType?: string; // "User" | "Bot"
  labels: Array<{ name: string }>;
}

// ── Trailer parsing ──────────────────────────────────────────────────────────

const AGENT_PUBKEY_TRAILER = /^Wooblay-Agent-Pubkey:\s*(.+)$/m;
const TASK_ID_TRAILER = /^Wooblay-Task-Id:\s*(.+)$/m;

/**
 * Parse git trailers from a commit message.
 * Git trailers appear in the last paragraph of the message.
 */
export function parseTrailers(message: string): { agentPubkey?: string; taskId?: string } {
  // Git trailers are in the last paragraph (after last blank line)
  const paragraphs = message.split(/\n\n+/);
  const lastParagraph = paragraphs[paragraphs.length - 1] ?? '';

  const pubkeyMatch = AGENT_PUBKEY_TRAILER.exec(lastParagraph);
  const taskIdMatch = TASK_ID_TRAILER.exec(lastParagraph);

  return {
    agentPubkey: pubkeyMatch?.[1]?.trim(),
    taskId: taskIdMatch?.[1]?.trim(),
  };
}

// ── Detection mode: Trailer ──────────────────────────────────────────────────

/**
 * Check a commit message for Wooblay agent trailers.
 */
export function detectByTrailer(commit: CommitInfo): AgentDetectionResult {
  const { agentPubkey, taskId } = parseTrailers(commit.message);

  if (agentPubkey) {
    return {
      isAgent: true,
      agentPubkey,
      detectionMode: 'trailer',
      taskId,
    };
  }

  return { isAgent: false };
}

// ── Detection mode: Label ────────────────────────────────────────────────────

const LABEL_PREFIX = 'wooblay-agent:';

/**
 * Check PR labels for a wooblay-agent:<pubkey> label.
 */
export function detectByLabel(pr: PRInfo): AgentDetectionResult {
  for (const label of pr.labels) {
    if (label.name.startsWith(LABEL_PREFIX)) {
      const pubkey = label.name.slice(LABEL_PREFIX.length).trim();
      if (pubkey) {
        return {
          isAgent: true,
          agentPubkey: pubkey,
          detectionMode: 'label',
        };
      }
    }
  }

  return { isAgent: false };
}

// ── Detection mode: Bot identity ─────────────────────────────────────────────

/**
 * Check if the PR author is a bot GitHub account.
 */
export function detectByBot(pr: PRInfo): AgentDetectionResult {
  const isBot =
    pr.authorType === 'Bot' || pr.authorLogin.endsWith('[bot]');

  if (isBot) {
    return {
      isAgent: true,
      // Bot detection doesn't yield a pubkey — needs cross-reference with Agent registry
      detectionMode: 'bot',
    };
  }

  return { isAgent: false };
}

// ── Combined detection ───────────────────────────────────────────────────────

/**
 * Run all three detection modes on a PR, returning the first match.
 * Priority order: trailer (highest specificity) > label > bot.
 *
 * For trailer detection, pass the commits; for label/bot, pass the PR info.
 */
export function detectAgentPR(
  pr: PRInfo,
  commits: CommitInfo[],
): AgentDetectionResult {
  // 1. Check commit trailers (highest priority — most specific)
  for (const commit of commits) {
    const trailerResult = detectByTrailer(commit);
    if (trailerResult.isAgent) {
      return trailerResult;
    }
  }

  // 2. Check PR labels
  const labelResult = detectByLabel(pr);
  if (labelResult.isAgent) return labelResult;

  // 3. Check bot identity (lowest priority)
  return detectByBot(pr);
}

/**
 * Detect whether a single commit is from an agent.
 * Uses trailer detection first, then falls back to bot identity check.
 */
export function detectAgentCommit(commit: CommitInfo): AgentDetectionResult {
  // Trailer takes priority
  const trailerResult = detectByTrailer(commit);
  if (trailerResult.isAgent) return trailerResult;

  // Bot check on commit author
  const isBot =
    commit.authorType === 'Bot' || commit.authorLogin.endsWith('[bot]');

  if (isBot) {
    return { isAgent: true, detectionMode: 'bot' };
  }

  return { isAgent: false };
}
