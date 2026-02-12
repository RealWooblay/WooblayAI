export enum ApprovalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  DENIED = 'DENIED',
  EXPIRED = 'EXPIRED',
}

export interface Approval {
  id: string;
  toolCallId: string;
  status: ApprovalStatus;
  approver: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  ttlSeconds: number;
  /** Joined toolCall (included when API returns with `include: { toolCall: true }`) */
  toolCall?: {
    id: string;
    taskId: string | null;
    sessionId: string | null;
    agentPubkey: string;
    toolName: string;
    args: string;
    riskTier: string;
    adapter: string | null;
    createdAt: string;
  };
  /** Human-readable description from Gate analysis engine */
  humanDescription?: string;
  /** Human-readable risk explanation */
  riskExplanation?: string;
  /** Backwards compat alias */
  description?: string;
}
