import type { RiskTier } from '../domain/tool-call.js';
import type { ApprovalStatus } from '../domain/approval.js';
import type { TrustLevel, Severity } from '../domain/analysis.js';
import type { RunStatus } from '../domain/run.js';
import type { OperationStatus, OperationPriority, RoutingStatus } from '../domain/operation.js';
import type { ProposalStatus } from '../domain/proposal.js';
import type { EvidenceStatus } from '../domain/evidence.js';

export type WooblayEvent =
  // Existing events
  | { type: 'approval.created';        data: { approvalId: string; toolCallId: string; toolName: string; riskTier: RiskTier } }
  | { type: 'approval.resolved';       data: { approvalId: string; status: ApprovalStatus; approver?: string } }
  | { type: 'execution.started';       data: { toolCallId: string } }
  | { type: 'execution.output';        data: { toolCallId: string; stream: 'stdout' | 'stderr'; chunk: string } }
  | { type: 'execution.completed';     data: { toolCallId: string; exitCode: number } }
  | { type: 'receipt.created';         data: { receiptId: string; toolCallId: string } }
  | { type: 'policy.updated';          data: { policyId: string } }
  // Agent Identity & Analyzer events
  | { type: 'score.created';           data: { scoreId: string; taskId: string; agentPubkey: string } }
  | { type: 'agent.spawned';           data: { spawnerPubkey: string; spawnedPubkey: string; attestationId: string } }
  | { type: 'agent.trust.changed';     data: { agentPubkey: string; from: TrustLevel; to: TrustLevel; trigger: string } }
  | { type: 'analysis.created';        data: { analysisId: string; agentPubkey: string; severity: Severity; taskId?: string; receiptId?: string } }
  | { type: 'analysis.finding.new';    data: { analysisId: string; findingCode: string; agentPubkey: string } }
  | { type: 'analysis.finding.resolved'; data: { analysisId: string; findingCode: string; agentPubkey: string } }
  | { type: 'canary.tripped';          data: { canaryId: string; agentPubkey: string; type: string } }
  // ── Operation events (was Incident) ─────────────────────────────────
  | { type: 'operation.created';       data: { operationId: string; source: string; priority: OperationPriority; title: string } }
  | { type: 'operation.updated';       data: { operationId: string; status: OperationStatus; previousStatus: OperationStatus } }
  | { type: 'operation.routed';        data: { operationId: string; instanceId: string | null; confidence: number; status: RoutingStatus; classifiedIntent?: string } }
  // Backward-compat aliases
  | { type: 'incident.created';        data: { incidentId: string; source: string; priority: OperationPriority; title: string } }
  | { type: 'incident.updated';        data: { incidentId: string; status: OperationStatus; previousStatus: OperationStatus } }
  // ── Run events ──────────────────────────────────────────────────────
  | { type: 'run.created';             data: { runId: string; operationId: string; priority: string } }
  | { type: 'run.state_changed';       data: { runId: string; from: RunStatus; to: RunStatus; reason?: string } }
  | { type: 'run.quarantined';         data: { runId: string; reason: string } }
  | { type: 'run.budget_exceeded';     data: { runId: string; budgetCents: number; spentCents: number } }
  // ── Proposal events ─────────────────────────────────────────────────
  | { type: 'proposal.created';        data: { proposalId: string; runId: string; actionClass: string; riskClass: string } }
  | { type: 'proposal.decided';        data: { proposalId: string; status: ProposalStatus; approver?: string } }
  // ── Evidence events ─────────────────────────────────────────────────
  | { type: 'evidence.started';        data: { evidenceId: string; runId: string; recipeType: string } }
  | { type: 'evidence.completed';      data: { evidenceId: string; status: EvidenceStatus; reproducible: boolean } }
  // ── Simulation events ──────────────────────────────────────────────
  | { type: 'simulation.completed';    data: { runId: string; action: string; strategy: string; passed: boolean } }
  // ── Secure Execution events ───────────────────────────────────────
  | { type: 'secure_exec.completed';   data: { runId: string; action: string; success: boolean; durationMs: number; containerId: string; toolName?: string } }
  // ── Gateway events ──────────────────────────────────────────────────
  | { type: 'gateway.executed';        data: { callerId?: string; capabilityId?: string; authMode?: string; runId?: string | null; actionClass: string; success: boolean; containerId?: string } }
  | { type: 'gateway.bypass_attempt';  data: { runId?: string; target: string; blocked: boolean } }
  | { type: 'gateway.auth_failed';     data: { target: string; reason: string } }
  | { type: 'gateway.policy_denied';   data: { apiKeyId: string; action: string; riskTier: string; category: string; policyRuleId?: string } }
  | { type: 'gateway.policy_passed';   data: { apiKeyId: string; action: string; riskTier: string; category: string; decision: string } }
  // ── API Key events ────────────────────────────────────────────────────
  | { type: 'api_key.created';         data: { apiKeyId: string; orgId: string; name: string } }
  | { type: 'api_key.revoked';         data: { apiKeyId: string; orgId: string } }
  // ── Capability events ───────────────────────────────────────────────
  | { type: 'capability.issued';       data: { capabilityId: string; runId: string; actionClass: string; expiresAt: string; scopeHash?: string; policySnapshotHash?: string | null } }
  | { type: 'capability.revoked';      data: { capabilityId: string; reason: string } }
  | { type: 'capability.expired';      data: { capabilityId: string } }
  // ── Verification events ─────────────────────────────────────────────
  | { type: 'verification.completed';  data: { verificationId: string; proposalId: string; status: string } }
  // ── MCP Verification events ────────────────────────────────────────
  | { type: 'mcp_pre_verification.completed';  data: { serverCommand: string; toolName: string; credentialEnvVars: string[]; safe: boolean; threatLevel: string; reasoning: string; concerns: string[]; source: string; durationMs: number } }
  | { type: 'mcp_verification.completed';      data: { toolName: string; serverCommand: string; passed: boolean; reasoning: string; discrepancies: string[]; durationMs: number } }
;

export type WooblayEventType = WooblayEvent['type'];

export interface StoredEvent {
  id: number;
  type: string;
  data: string; // JSON
  createdAt: string;
}
