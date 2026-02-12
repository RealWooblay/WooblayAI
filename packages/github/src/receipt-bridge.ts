/**
 * Receipt bridge — links GitHub PRs to Wooblay's cryptographic receipt chain.
 *
 * When a task link is established (taskId <-> PR), this module:
 * 1. Looks up all receipts for that task/agent
 * 2. Computes "receipt coverage" — what % of agent commits have corresponding receipts
 * 3. Returns the receipt hashes for enrichment
 */

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptRecord {
  hash: string;
  agentPubkey: string;
  toolCallId: string;
  timestamp: string; // ISO 8601
}

export interface AgentCommitRecord {
  sha: string;
  createdAt: string; // ISO 8601
}

export interface ReceiptBridgeResult {
  /** Receipt hashes linked to this PR. */
  receiptHashes: string[];
  /** Fraction of agent commits covered by receipts (0.0 - 1.0). */
  receiptCoverage: number;
  /** Number of agent commits that have matching receipts. */
  coveredCommits: number;
  /** Total agent commits. */
  totalAgentCommits: number;
}

export interface ReceiptBridgeConfig {
  /** Time window in minutes to match a commit to a receipt. Default: 5. */
  matchWindowMinutes: number;
}

const DEFAULT_CONFIG: ReceiptBridgeConfig = {
  matchWindowMinutes: 5,
};

// ── Coverage computation ─────────────────────────────────────────────────────

/**
 * Compute receipt coverage for a set of agent commits.
 *
 * A commit is "covered" if there exists at least one receipt whose timestamp
 * falls within `±matchWindowMinutes` of the commit's timestamp.
 */
export function computeReceiptCoverage(
  agentCommits: AgentCommitRecord[],
  receipts: ReceiptRecord[],
  config: Partial<ReceiptBridgeConfig> = {},
): ReceiptBridgeResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const windowMs = cfg.matchWindowMinutes * 60 * 1000;

  if (agentCommits.length === 0) {
    return {
      receiptHashes: receipts.map((r) => r.hash),
      receiptCoverage: 1.0, // vacuously true
      coveredCommits: 0,
      totalAgentCommits: 0,
    };
  }

  // Sort receipts by timestamp for efficient matching
  const sortedReceipts = [...receipts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  let coveredCommits = 0;

  for (const commit of agentCommits) {
    const commitTime = new Date(commit.createdAt).getTime();
    const windowStart = commitTime - windowMs;
    const windowEnd = commitTime + windowMs;

    // Check if any receipt falls within the window
    const isCovered = sortedReceipts.some((r) => {
      const receiptTime = new Date(r.timestamp).getTime();
      return receiptTime >= windowStart && receiptTime <= windowEnd;
    });

    if (isCovered) coveredCommits++;
  }

  return {
    receiptHashes: receipts.map((r) => r.hash),
    receiptCoverage: coveredCommits / agentCommits.length,
    coveredCommits,
    totalAgentCommits: agentCommits.length,
  };
}

/**
 * Detect task ID from commit trailers or PR comment commands.
 *
 * Supported formats:
 *   - Commit trailer: `Wooblay-Task-Id: <taskId>`
 *   - PR comment: `/wooblay link <taskId>`
 */
export function extractTaskIdFromComment(comment: string): string | undefined {
  const match = /\/wooblay\s+link\s+(\S+)/i.exec(comment);
  return match?.[1];
}
