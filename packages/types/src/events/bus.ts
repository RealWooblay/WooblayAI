import type { RiskTier } from '../domain/tool-call.js';
import type { ApprovalStatus } from '../domain/approval.js';
import type { TrustLevel, Severity } from '../domain/analysis.js';

export type WooblayEvent =
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
  | { type: 'canary.tripped';          data: { canaryId: string; agentPubkey: string; type: string } };

export type WooblayEventType = WooblayEvent['type'];

export interface StoredEvent {
  id: number;
  type: string;
  data: string; // JSON
  createdAt: string;
}
