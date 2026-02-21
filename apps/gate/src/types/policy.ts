/** Policy evaluation types. */

import type { RiskClass } from '@wooblay/types';

export interface ProposalPolicyInput {
  runId: string;
  actionClass: string;
  toolName: string;
  riskClass: RiskClass;
  irreversible: boolean;
  hasEvidence: boolean;
  estimatedCostCents?: number;
  instanceId?: string;
}

export interface ProposalPolicyDecision {
  decision: 'auto_approve' | 'require_approval' | 'deny';
  reason: string;
  ruleId?: string;
  policySnapshot: string;
  requiredApproverRole?: string;
  requiresEvidence: boolean;
  budgetCheck: { allowed: boolean; reason?: string };
}
