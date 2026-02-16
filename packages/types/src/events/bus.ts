import type { RiskTier } from '../domain/tool-call.js';
import type { ApprovalStatus } from '../domain/approval.js';
import type { TrustLevel, Severity } from '../domain/analysis.js';
import type { RunStatus } from '../domain/run.js';
import type { IncidentStatus, IncidentPriority } from '../domain/incident.js';
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
  // ── MVP: Incident events ──────────────────────────────────────────────
  | { type: 'incident.created';        data: { incidentId: string; source: string; priority: IncidentPriority; title: string } }
  | { type: 'incident.updated';        data: { incidentId: string; status: IncidentStatus; previousStatus: IncidentStatus } }
  // ── MVP: Run events ───────────────────────────────────────────────────
  | { type: 'run.created';             data: { runId: string; incidentId: string; priority: string } }
  | { type: 'run.state_changed';       data: { runId: string; from: RunStatus; to: RunStatus; reason?: string } }
  | { type: 'run.quarantined';         data: { runId: string; reason: string } }
  | { type: 'run.budget_exceeded';     data: { runId: string; budgetCents: number; spentCents: number } }
  // ── MVP: Proposal events ──────────────────────────────────────────────
  | { type: 'proposal.created';        data: { proposalId: string; runId: string; actionClass: string; riskClass: string } }
  | { type: 'proposal.decided';        data: { proposalId: string; status: ProposalStatus; approver?: string } }
  // ── MVP: Evidence events ──────────────────────────────────────────────
  | { type: 'evidence.started';        data: { evidenceId: string; runId: string; recipeType: string } }
  | { type: 'evidence.completed';      data: { evidenceId: string; status: EvidenceStatus; reproducible: boolean } }
  // ── MVP: Gateway events ───────────────────────────────────────────────
  | { type: 'gateway.executed';        data: { capabilityId: string; runId: string; actionClass: string; success: boolean } }
  | { type: 'gateway.bypass_attempt';  data: { runId?: string; target: string; blocked: boolean } }
  // ── MVP: Capability events ────────────────────────────────────────────
  | { type: 'capability.issued';       data: { capabilityId: string; runId: string; actionClass: string; expiresAt: string; scopeHash?: string; policySnapshotHash?: string | null } }
  | { type: 'capability.revoked';      data: { capabilityId: string; reason: string } }
  | { type: 'capability.expired';      data: { capabilityId: string } }
  // ── MVP: Verification events ──────────────────────────────────────────
  | { type: 'verification.completed';  data: { verificationId: string; proposalId: string; status: string } }
  // ── MVP: Rollback events ──────────────────────────────────────────────
  | { type: 'rollback.created';        data: { rollbackProposalId: string; originalProposalId: string; type: string } };

export type WooblayEventType = WooblayEvent['type'];

export interface StoredEvent {
  id: number;
  type: string;
  data: string; // JSON
  createdAt: string;
}
