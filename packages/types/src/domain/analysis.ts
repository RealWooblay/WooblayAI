// ── Receipt Analyzer + Agent Identity System Types ────────────────────────────

// ── Trust Levels ──────────────────────────────────────────────────────────────

export type TrustLevel = 'read-only' | 'write-with-approvals' | 'autonomous';

export const TRUST_THRESHOLDS: Record<TrustLevel, number> = {
  'read-only': 0,
  'write-with-approvals': 40,
  'autonomous': 80,
};

// ── Findings ──────────────────────────────────────────────────────────────────

export type FindingCode =
  // Layer 0: Deterministic
  | 'DESTRUCTIVE_CMD'
  | 'DOMAIN_DRIFT'
  | 'RETRY_LOOP'
  | 'APPROVAL_BYPASS'
  | 'READONLY_VIOLATION'
  | 'COST_TIME_BASELINE'
  | 'HUMAN_INTERVENTION'
  // Layer 1: Statistical / Identity
  | 'IDENTITY_DRIFT'
  | 'CROSS_AGENT_CORRELATION'
  | 'CANARY_TRIP'
  | 'SPAWN_CHAIN_ANOMALY';

export type SuggestedAction =
  | 'needs-human'
  | 'demote-trust'
  | 'suspend-agent'
  | 'block-lineage'
  | 'review-policy'
  | 'info-only';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export interface Finding {
  code: FindingCode;
  message: string;
  evidenceRefs: string[];   // receipt hashes, toolCall IDs
  confidence: number;       // 0-1, subject to decay
  suggestedAction: SuggestedAction;
  decayRate?: number;       // how fast confidence fades per day (default 0.95)
  detectedAt: string;       // ISO timestamp
}

// ── Causal Chain ──────────────────────────────────────────────────────────────

export type CausalVerdict = 'benign' | 'suspicious' | 'malicious';

export interface CausalChainNode {
  receiptHash: string;
  toolCallId: string;
  action: string;           // human-readable action description
  timestamp: string;
  verdict: CausalVerdict;
  linksTo: string[];        // receipt hashes this node leads to
}

// ── Analysis ──────────────────────────────────────────────────────────────────

export interface Analysis {
  id: string;
  taskId: string | null;
  receiptId: string | null;
  agentPubkey: string;
  severity: Severity;
  tags: string[];
  summary: string;
  findings: Finding[];
  causalChain: CausalChainNode[] | null;
  briefMarkdown: string | null;
  createdAt: string;
}

// ── Agent Behavioral Profile ──────────────────────────────────────────────────

export interface AgentProfile {
  /** Tool usage distribution (normalized frequencies, sum to 1) */
  toolMix: Record<string, number>;
  /** Risk tier distribution (normalized frequencies, sum to 1) */
  riskMix: Record<string, number>;
  /** Average session duration in milliseconds */
  avgSessionDurationMs: number;
  /** Average tool calls per task */
  avgToolCallsPerTask: number;
  /** Average time between consecutive tool calls in ms */
  avgTimeBetweenCallsMs: number;
  /** Fraction of calls that needed approval */
  approvalRate: number;
  /** Fraction of calls that were denied */
  denialRate: number;
  /** Top 5 domains accessed (for browser/http agents) */
  topDomains: string[];
  /** When this profile was last computed */
  computedAt: string;
  /** Number of tool calls this profile is based on */
  sampleSize: number;
}

// ── Agent Baseline (rolling stats + trust trajectory) ─────────────────────────

export interface TrustHistoryEntry {
  date: string;
  score: number;
  level: TrustLevel;
}

export interface AgentBaseline {
  avgCostPerTask: number;
  avgDurationPerTask: number;
  avgToolCallsPerTask: number;
  p95CostPerTask: number;
  p95DurationPerTask: number;
  /** Rolling trust score snapshots (last 90 days) */
  trustHistory: TrustHistoryEntry[];
  updatedAt: string;
}

// ── Spawn Attestation ─────────────────────────────────────────────────────────

export interface SpawnScope {
  allowedTools: string[];
  allowedDomains: string[];
  riskCeiling: string;
  maxDuration?: number;
  maxToolCalls?: number;
}

export interface SpawnAttestation {
  id: string;
  spawnerPubkey: string;
  spawnedPubkey: string;
  purpose: string;
  scope: SpawnScope | null;
  constraints: Record<string, unknown> | null;
  signature: string;
  createdAt: string;
}

// ── Canary ────────────────────────────────────────────────────────────────────

export type CanaryType = 'path' | 'credential' | 'url' | 'token';

export interface Canary {
  id: string;
  type: CanaryType;
  value: string;
  description: string;
  active: boolean;
  trippedBy: string | null;
  trippedAt: string | null;
  createdAt: string;
}

// ── Trust Transition ──────────────────────────────────────────────────────────

export interface TrustTransition {
  from: TrustLevel;
  to: TrustLevel;
  trigger: string;          // finding code or "manual_override"
  agentPubkey: string;
  timestamp: string;
}

// ── Agent Insights (aggregated view) ──────────────────────────────────────────

export interface FailureMode {
  code: FindingCode;
  count: number;
  lastSeen: string;
}

export interface DenyPattern {
  toolName: string;
  argSignature: string;     // truncated canonical args
  count: number;
}

export interface SeverityBucket {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface AgentInsights {
  profile: AgentProfile | null;
  trustTrajectory: TrustHistoryEntry[];
  topFailureModes: FailureMode[];
  commonDenies: DenyPattern[];
  reliability: {
    successRate: number;
    avgFindingsPerTask: number;
    totalTasks: number;
  };
  lineage: {
    parent: { pubkey: string; name: string; trustScore: number } | null;
    children: Array<{ pubkey: string; name: string; trustScore: number; spawnDepth: number }>;
  };
  recentSeverityTrend: SeverityBucket[];
  spawnCount: {
    direct: number;
    total: number;
  };
  totalAnalyses: number;
  criticalCount: number;
  highCount: number;
}

// ── Lineage Tree Node ─────────────────────────────────────────────────────────

export interface LineageNode {
  pubkey: string;
  name: string;
  status: string;
  trustLevel: TrustLevel;
  trustScore: number;
  spawnDepth: number;
  children: LineageNode[];
}
