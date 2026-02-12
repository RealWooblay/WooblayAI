import { z } from 'zod';
import { DecisionTrailSchema } from '../domain/index.js';

// ---------- Request Schemas ----------

export const ToolExecuteRequestSchema = z.object({
  toolName: z.string().min(1),
  args: z.record(z.unknown()),
  taskId: z.string().optional(),
  sessionId: z.string().optional(),
  agentPubkey: z.string().min(1),
  requestSignature: z.string().min(1),
  decisionTrail: DecisionTrailSchema.optional(),
  adapter: z.string().optional(),
});

export const ApprovalDecisionRequestSchema = z.object({
  approver: z.string().min(1),
  reason: z.string().optional(),
});

export const CreateScoreRequestSchema = z.object({
  taskId: z.string().min(1),
  agentPubkey: z.string().min(1),
  label: z.enum(['SUCCESS', 'FAIL', 'NEEDS_HUMAN', 'REGRESSION']),
  cost: z.number().optional(),
  duration: z.number().optional(),
  notes: z.string().optional(),
});

export const CreatePolicyRequestSchema = z.object({
  priority: z.number().int().min(0),
  matchTool: z.string().min(1),
  matchArgs: z.string().optional(),
  riskTier: z.string().min(1),
  decision: z.enum(['ALLOW', 'DENY', 'APPROVE']),
  constraints: z.string().optional(),
  enabled: z.boolean().optional().default(true),
});

export const UpdatePolicyRequestSchema = CreatePolicyRequestSchema.partial();

export const CreateAgentRequestSchema = z.object({
  pubkey: z.string().min(1),
  name: z.string().min(1),
  allowlisted: z.boolean().optional().default(false),
});

export const UpdateAgentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended', 'revoked']).optional(),
  allowlisted: z.boolean().optional(),
});

export const CreateCheckpointRequestSchema = z.object({
  toolName: z.string().min(1),
  scope: z.string().min(1),
  path: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

export const ReportExecutionRequestSchema = z.object({
  toolCallId: z.string().min(1),
  status: z.enum(['running', 'completed', 'failed', 'timeout']),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.number().int().optional(),
  durationMs: z.number().int().optional(),
  artifactsMeta: z.record(z.unknown()).optional(),
});

// ---------- Query Schemas ----------

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const TimelineQuerySchema = z.object({
  taskId: z.string().min(1),
});

export const StatsQuerySchema = z.object({
  agentPubkey: z.string().optional(),
  toolName: z.string().optional(),
  since: z.string().optional(),
});

export const EventsQuerySchema = z.object({
  types: z.string().optional(), // comma-separated event types
  since: z.string().optional(), // last event id
});

// ── Analyzer + Identity Request Schemas ──────────────────────────────────────

export const SpawnAgentRequestSchema = z.object({
  spawnerPubkey: z.string().min(1),
  spawnedPubkey: z.string().min(1),
  spawnedName: z.string().min(1),
  purpose: z.string().min(1),
  scope: z.object({
    allowedTools: z.array(z.string()),
    allowedDomains: z.array(z.string()),
    riskCeiling: z.string(),
    maxDuration: z.number().optional(),
    maxToolCalls: z.number().optional(),
  }).optional(),
  signature: z.string().min(1),
});

export const TrustOverrideRequestSchema = z.object({
  trustLevel: z.enum(['read-only', 'write-with-approvals', 'autonomous']),
  reason: z.string().min(1),
  operator: z.string().min(1),
});

export const RecomputeAnalysisQuerySchema = z.object({
  taskId: z.string().min(1),
});

export const CreateCanaryRequestSchema = z.object({
  type: z.enum(['path', 'credential', 'url', 'token']),
  value: z.string().min(1),
  description: z.string().min(1),
});
