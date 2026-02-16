export type IncidentSource = 'github_ci' | 'github_agent_pr' | 'github_pr_opened' | 'github_push' | 'manual';
export type IncidentPriority = 'P0' | 'P1' | 'P2';
export type IncidentStatus = 'open' | 'triaging' | 'in_progress' | 'resolved' | 'closed';
export type IncidentIntent = 'fix' | 'qa' | 'review' | 'deploy' | 'custom';

export interface Incident {
  id: string;
  externalId: string | null;
  source: IncidentSource;
  sourcePayload: string | null;
  title: string;
  summary: string | null;
  priority: IncidentPriority;
  status: IncidentStatus;
  intent: IncidentIntent;
  repoFullName: string | null;
  branch: string | null;
  commitSha: string | null;
  prNumber: number | null;
  createdAt: string;
  updatedAt: string;
}
