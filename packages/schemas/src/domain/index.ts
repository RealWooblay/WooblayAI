import { z } from 'zod';

// ---------- Enums ----------
export const RiskTierSchema = z.enum(['READ', 'WRITE', 'DESTRUCTIVE']);
export const DecisionSchema = z.enum(['ALLOW', 'DENY', 'APPROVE']);
export const ApprovalStatusSchema = z.enum(['PENDING', 'APPROVED', 'DENIED', 'EXPIRED']);
export const AgentStatusSchema = z.enum(['active', 'suspended', 'revoked']);
export const ExecStatusSchema = z.enum(['running', 'completed', 'failed', 'timeout']);
export const ScoreLabelSchema = z.enum(['SUCCESS', 'FAIL', 'NEEDS_HUMAN', 'REGRESSION']);
export const TrustLevelSchema = z.enum(['read-only', 'write-with-approvals', 'autonomous']);
export const SeveritySchema = z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
export const FindingCodeSchema = z.enum([
  'DESTRUCTIVE_CMD', 'DOMAIN_DRIFT', 'RETRY_LOOP', 'APPROVAL_BYPASS',
  'READONLY_VIOLATION', 'COST_TIME_BASELINE', 'HUMAN_INTERVENTION',
  'IDENTITY_DRIFT', 'CROSS_AGENT_CORRELATION', 'CANARY_TRIP', 'SPAWN_CHAIN_ANOMALY',
]);
export const SuggestedActionSchema = z.enum([
  'needs-human', 'demote-trust', 'suspend-agent', 'block-lineage', 'review-policy', 'info-only',
]);
export const CanaryTypeSchema = z.enum(['path', 'credential', 'url', 'token']);

// ---------- Domain Schemas ----------
export const AgentSchema = z.object({
  id: z.string(),
  pubkey: z.string(),
  name: z.string(),
  status: AgentStatusSchema,
  allowlisted: z.boolean(),
  trustLevel: TrustLevelSchema.default('read-only'),
  trustScore: z.number().default(50),
  parentPubkey: z.string().nullable().default(null),
  spawnDepth: z.number().int().default(0),
  profileJson: z.string().nullable().default(null),
  baselineJson: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ToolCallSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  sessionId: z.string().nullable(),
  agentPubkey: z.string(),
  toolName: z.string(),
  args: z.string(),
  riskTier: RiskTierSchema,
  createdAt: z.string(),
});

export const PolicyRuleSchema = z.object({
  id: z.string(),
  priority: z.number().int(),
  matchTool: z.string(),
  matchArgs: z.string().nullable(),
  riskTier: z.string(),
  decision: DecisionSchema,
  constraints: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ApprovalSchema = z.object({
  id: z.string(),
  toolCallId: z.string(),
  status: ApprovalStatusSchema,
  approver: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  ttlSeconds: z.number().int(),
});

export const CitationSchema = z.object({
  type: z.enum(['url', 'tool_output', 'file']),
  ref: z.string(),
  hash: z.string().optional(),
});

export const DecisionTrailSchema = z.object({
  plan_summary: z.string(),
  reason_summary: z.string(),
  inputs_used: z.array(z.string()),
  citations: z.array(CitationSchema),
});

export const ExecutionSummarySchema = z.object({
  status: z.string(),
  exitCode: z.number().nullable(),
  stdoutPreview: z.string(),
  durationMs: z.number(),
});

export const ReceiptSchema = z.object({
  id: z.string(),
  toolCallId: z.string(),
  agentPubkey: z.string(),
  toolName: z.string(),
  riskTier: z.string(),
  policyDecision: z.string(),
  policyRuleId: z.string().nullable(),
  approvalDecision: z.string().nullable(),
  approver: z.string().nullable(),
  executionSummary: ExecutionSummarySchema.nullable(),
  decisionTrail: DecisionTrailSchema,
  chainPrev: z.string().nullable(),
  timestamp: z.string(),
  hash: z.string(),
  signature: z.string(),
  createdAt: z.string(),
});

export const ScoreSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  agentPubkey: z.string(),
  label: ScoreLabelSchema,
  cost: z.number().nullable(),
  duration: z.number().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});

export const CheckpointSchema = z.object({
  id: z.string(),
  toolName: z.string(),
  scope: z.string(),
  path: z.string(),
  metadata: z.string().nullable(),
  createdAt: z.string(),
});

export const ExecutionSchema = z.object({
  id: z.string(),
  toolCallId: z.string(),
  status: ExecStatusSchema,
  stdout: z.string().nullable(),
  stderr: z.string().nullable(),
  exitCode: z.number().nullable(),
  durationMs: z.number().nullable(),
  artifactsMeta: z.string().nullable(),
  createdAt: z.string(),
});

// ── Analyzer + Identity Schemas ──────────────────────────────────────────────

export const FindingSchema = z.object({
  code: FindingCodeSchema,
  message: z.string(),
  evidenceRefs: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  suggestedAction: SuggestedActionSchema,
  decayRate: z.number().min(0).max(1).optional(),
  detectedAt: z.string(),
});

export const CausalChainNodeSchema = z.object({
  receiptHash: z.string(),
  toolCallId: z.string(),
  action: z.string(),
  timestamp: z.string(),
  verdict: z.enum(['benign', 'suspicious', 'malicious']),
  linksTo: z.array(z.string()),
});

export const AnalysisSchema = z.object({
  id: z.string(),
  taskId: z.string().nullable(),
  receiptId: z.string().nullable(),
  agentPubkey: z.string(),
  severity: SeveritySchema,
  tags: z.array(z.string()),
  summary: z.string(),
  findings: z.array(FindingSchema),
  causalChain: z.array(CausalChainNodeSchema).nullable(),
  briefMarkdown: z.string().nullable(),
  createdAt: z.string(),
});

export const SpawnScopeSchema = z.object({
  allowedTools: z.array(z.string()),
  allowedDomains: z.array(z.string()),
  riskCeiling: z.string(),
  maxDuration: z.number().optional(),
  maxToolCalls: z.number().optional(),
});

export const CanarySchema = z.object({
  id: z.string(),
  type: CanaryTypeSchema,
  value: z.string(),
  description: z.string(),
  active: z.boolean(),
  trippedBy: z.string().nullable(),
  trippedAt: z.string().nullable(),
  createdAt: z.string(),
});
