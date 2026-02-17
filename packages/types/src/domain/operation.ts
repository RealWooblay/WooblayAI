export type OperationSource = 'github_ci' | 'github_agent_pr' | 'github_pr_opened' | 'github_push' | 'manual' | 'api' | 'follow_up' | string;
export type OperationPriority = 'P0' | 'P1' | 'P2';
export type OperationStatus = 'open' | 'triaging' | 'in_progress' | 'resolved' | 'closed';
export type OperationIntent = 'fix' | 'qa' | 'review' | 'deploy' | 'custom' | string;
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
  parentOperationId: string | null;
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

/**
 * Event rule — user declares what events they care about and a default intent.
 *
 * This is NOT workflow configuration. The user says "I care about CI failures
 * and the default intent is fix." The AI handles everything else:
 * - Reclassifies intent from context when the default doesn't fit
 * - Escalates priority based on risk signals, change size, etc.
 * - Decides follow-up operations when this one resolves
 * - Routes to the best agent based on role, history, specialization
 *
 * The event field is a string, not an enum — any sensor type can define
 * its own event types. GitHub uses 'ci_failure', 'pr_opened', 'push', 'pr_merged'.
 * A security sensor might use 'vulnerability_detected', 'audit_alert'.
 * A monitoring sensor might use 'alert_fired', 'threshold_breached'.
 */
export interface SensorEventRule {
  /** Event type identifier — sensor-specific, not a fixed enum */
  event: string;
  /** Default intent — AI may reclassify based on context */
  intent: OperationIntent;
  /** Default priority — AI may escalate based on context signals */
  priority?: OperationPriority;
  /** Whether this rule is active */
  enabled: boolean;
}

/** Sensor config types per provider */
export interface GitHubSensorConfig {
  watchEvents: ('check_run' | 'pull_request' | 'push' | 'issues')[];
  branchFilter?: string[];
  ignoreDrafts: boolean;
  ignoreBot: boolean;
  autoCreateRun: boolean;
  /**
   * User-defined event rules. Declares what events create operations.
   * If no rules are set, ALL matched events create operations with
   * intent='pending_classification' — the AI router classifies from context.
   * If rules ARE set, only events with a matching enabled rule produce operations.
   */
  eventRules?: SensorEventRule[];
}

export const DEFAULT_GITHUB_SENSOR_CONFIG: GitHubSensorConfig = {
  watchEvents: ['check_run', 'pull_request', 'push'],
  ignoreDrafts: true,
  ignoreBot: true,
  autoCreateRun: true,
};
