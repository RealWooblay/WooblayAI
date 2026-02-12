export enum Decision {
  ALLOW = 'ALLOW',
  DENY = 'DENY',
  APPROVE = 'APPROVE',
}

export interface PolicyRule {
  id: string;
  priority: number;
  matchTool: string;    // glob: "wooblay_exec", "wooblay_*", "*"
  matchArgs: string | null;  // JSON pattern
  riskTier: string;     // RiskTier or "*"
  decision: Decision;
  constraints: string | null; // JSON
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyDecision {
  decision: Decision;
  ruleId?: string;
  reason?: string;
  constraints?: Record<string, unknown>;
}
