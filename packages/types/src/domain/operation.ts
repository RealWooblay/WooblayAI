export type OperationSource = 'github_ci' | 'github_agent_pr' | 'github_pr_opened' | 'github_push' | 'manual' | 'api';
export type OperationPriority = 'P0' | 'P1' | 'P2';
export type OperationStatus = 'open' | 'triaging' | 'in_progress' | 'resolved' | 'closed';
export type OperationIntent = 'fix' | 'qa' | 'review' | 'deploy' | 'custom';
export type RoutingStatus = 'pending' | 'auto_routed' | 'approved' | 'manual';

export interface Operation {
  id: string;
  orgId: string | null;
  externalId: string | null;
  source: OperationSource;
  sourcePayload: string | null;
  title: string;
  summary: string | null;
  priority: OperationPriority;
  status: OperationStatus;
  intent: OperationIntent;
  repoFullName: string | null;
  branch: string | null;
  commitSha: string | null;
  prNumber: number | null;
  connectionId: string | null;
  // Agent routing
  instanceId: string | null;
  routingConfidence: number | null;
  routingStatus: RoutingStatus;
  routingReason: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Backward-compat aliases */
export type IncidentSource = OperationSource;
export type IncidentPriority = OperationPriority;
export type IncidentStatus = OperationStatus;
export type IncidentIntent = OperationIntent;
export type Incident = Operation;

/** Sensor config types per provider */
export interface GitHubSensorConfig {
  watchEvents: ('check_run' | 'pull_request' | 'push' | 'issues')[];
  branchFilter?: string[];
  ignoreDrafts: boolean;
  ignoreBot: boolean;
  autoCreateRun: boolean;
  intentOverrides?: Record<string, OperationIntent>;
}

export const DEFAULT_GITHUB_SENSOR_CONFIG: GitHubSensorConfig = {
  watchEvents: ['check_run', 'pull_request', 'push'],
  ignoreDrafts: true,
  ignoreBot: true,
  autoCreateRun: true,
};
