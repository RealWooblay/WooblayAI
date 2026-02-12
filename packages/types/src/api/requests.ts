import type { DecisionTrail } from '../domain/receipt.js';

// POST /api/tool/execute
export interface ToolExecuteRequest {
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  sessionId?: string;
  agentPubkey: string;
  requestSignature: string;
  decisionTrail?: DecisionTrail;
  /** Which adapter submitted this tool call (e.g. "openclaw-plugin", "mcp-toolhost") */
  adapter?: string;
}

// POST /api/approvals/:id/approve or deny
export interface ApprovalDecisionRequest {
  approver: string;
  reason?: string;
}

// POST /api/scores
export interface CreateScoreRequest {
  taskId: string;
  agentPubkey: string;
  label: string;
  cost?: number;
  duration?: number;
  notes?: string;
}

// POST /api/policies
export interface CreatePolicyRequest {
  priority: number;
  matchTool: string;
  matchArgs?: string;
  riskTier: string;
  decision: string;
  constraints?: string;
  enabled?: boolean;
}

export interface UpdatePolicyRequest extends Partial<CreatePolicyRequest> {}

// POST /api/agents
export interface CreateAgentRequest {
  pubkey: string;
  name: string;
  allowlisted?: boolean;
}

export interface UpdateAgentRequest {
  name?: string;
  status?: string;
  allowlisted?: boolean;
}

// POST /api/checkpoints/create
export interface CreateCheckpointRequest {
  toolName: string;
  scope: string;
  path: string;
  metadata?: Record<string, unknown>;
}

// POST /api/executions
export interface ReportExecutionRequest {
  toolCallId: string;
  status: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  durationMs?: number;
  artifactsMeta?: Record<string, unknown>;
}

// ── Analyzer + Identity Requests ──────────────────────────────────────────────

// POST /api/agents/spawn
export interface SpawnAgentRequest {
  spawnerPubkey: string;
  spawnedPubkey: string;
  spawnedName: string;
  purpose: string;
  scope?: {
    allowedTools: string[];
    allowedDomains: string[];
    riskCeiling: string;
    maxDuration?: number;
    maxToolCalls?: number;
  };
  signature: string;
}

// POST /api/agents/:pubkey/trust/override
export interface TrustOverrideRequest {
  trustLevel: string;
  reason: string;
  operator: string;
}

// POST /api/analysis/recompute
export interface RecomputeAnalysisRequest {
  taskId: string;
}

// POST /api/canaries
export interface CreateCanaryRequest {
  type: string;
  value: string;
  description?: string;
}
