/** Agent routing types. */

export interface RoutingResult {
  instanceId: string | null;
  confidence: number;
  status: 'auto_routed' | 'pending' | 'needs_approval';
  reason: string;
  /** AI-classified intent (replaces sensor's suggestion) */
  classifiedIntent?: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  role: string;
  status: string;
}
