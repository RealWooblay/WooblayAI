export type ProposalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'executed'
  | 'verified';

export type RiskClass = 'low' | 'medium' | 'high' | 'critical';

export interface Proposal {
  id: string;
  runId: string;
  actionClass: string;
  toolName: string;
  argsHash: string;
  rawArgs: string | null;
  riskClass: RiskClass;
  irreversible: boolean;
  compensatingAction: string | null;
  evidenceBundleId: string | null;
  status: ProposalStatus;
  approver: string | null;
  approverEmail: string | null;
  approverRole: string | null;
  approvedAt: string | null;
  policyRuleId: string | null;
  policySnapshot: string | null;
  verificationId: string | null;
  toolCallId: string | null;
  createdAt: string;
}
