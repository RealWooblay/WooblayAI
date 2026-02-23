/** Agent routing types. */

export interface RoutingResult {
  instanceId: string | null;
  confidence: number;
  status: 'auto_routed' | 'pending' | 'needs_approval';
  reason: string;
  /** AI-classified intent (replaces sensor's suggestion) */
  classifiedIntent?: string;
  /** AI-assessed risk level of the operation */
  riskAssessment?: 'low' | 'medium' | 'high';
  /** AI-recommended follow-up operation (created when parent resolves) */
  suggestedFollowUp?: { intent: string; reason: string } | null;
}

export interface AgentHistory {
  totalRouted: number;
  completedSuccessfully: number;
  failedOrTimedOut: number;
  avgCompletionMinutes: number | null;
  recentIntents: string[];
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
  /** Routing history for this agent (loaded from DB) */
  history?: AgentHistory;
}
