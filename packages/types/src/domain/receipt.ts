export interface Citation {
  type: 'url' | 'tool_output' | 'file';
  ref: string;
  hash?: string;
}

export interface DecisionTrail {
  plan_summary: string;
  reason_summary: string;
  inputs_used: string[];
  citations: Citation[];
}

export interface ExecutionSummary {
  status: string;
  exitCode: number | null;
  stdoutPreview: string; // first 500 chars
  durationMs: number;
}

export interface Receipt {
  id: string;            // = content hash
  toolCallId: string;
  agentPubkey: string;
  toolName: string;
  riskTier: string;
  policyDecision: string;
  policyRuleId: string | null;
  approvalDecision: string | null;
  approver: string | null;
  executionSummary: ExecutionSummary | null;
  decisionTrail: DecisionTrail;
  chainPrev: string | null;
  timestamp: string;     // ISO 8601
  hash: string;
  signature: string;
  createdAt: string;
}
