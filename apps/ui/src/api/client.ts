import type {
  Approval,
  Agent,
  PolicyRule,
  Receipt,
  Score,
  ToolCall,
  StatsResponse,
  PolicySuggestion,
  HealthResponse,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  CreateScoreRequest,
  ApprovalDecisionRequest,
} from '@wooblay/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toQueryString(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== '');
  if (!entries.length) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

// ---------------------------------------------------------------------------
// Base fetch
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`API ${status}: ${statusText}`);
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

export async function fetchApi<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, res.statusText, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export const getApprovals = () =>
  fetchApi<Approval[]>('/api/approvals/pending');

export const approveApproval = (id: string, body: ApprovalDecisionRequest) =>
  fetchApi<Approval>(`/api/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const denyApproval = (id: string, body: ApprovalDecisionRequest) =>
  fetchApi<Approval>(`/api/approvals/${id}/deny`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  toolCall: ToolCall;
  receipt: Receipt | null;
  approval: Approval | null;
}

export const getTimeline = (taskId: string) =>
  fetchApi<TimelineEntry[]>(`/api/tasks/${taskId}/timeline`);

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

export const getReceipt = (hash: string) =>
  fetchApi<Receipt>(`/api/receipts/${hash}`);

export const verifyReceipt = (hash: string) =>
  fetchApi<{ valid: boolean; reason?: string }>(`/api/receipts/${hash}/verify`);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const getAgents = () => fetchApi<Agent[]>('/api/agents');

export const createAgent = (body: CreateAgentRequest) =>
  fetchApi<Agent>('/api/agents', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateAgent = (id: string, body: UpdateAgentRequest) =>
  fetchApi<Agent>(`/api/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deleteAgent = (id: string) =>
  fetchApi<void>(`/api/agents/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export const getPolicies = () => fetchApi<PolicyRule[]>('/api/policies');

export const createPolicy = (body: CreatePolicyRequest) =>
  fetchApi<PolicyRule>('/api/policies', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updatePolicy = (id: string, body: UpdatePolicyRequest) =>
  fetchApi<PolicyRule>(`/api/policies/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const deletePolicy = (id: string) =>
  fetchApi<void>(`/api/policies/${id}`, { method: 'DELETE' });

export interface PolicyPresetSummary {
  key: string;
  name: string;
  description: string;
  ruleCount: number;
}

export const getPolicyPresets = () =>
  fetchApi<PolicyPresetSummary[]>('/api/policies/presets');

export const applyPolicyPreset = (key: string) =>
  fetchApi<{ applied: string; rules: PolicyRule[] }>(`/api/policies/presets/${key}/apply`, {
    method: 'POST',
  });

// ---------------------------------------------------------------------------
// Scores
// ---------------------------------------------------------------------------

export const getScores = () => fetchApi<Score[]>('/api/scores');

export const createScore = (body: CreateScoreRequest) =>
  fetchApi<Score>('/api/scores', {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const getStats = () => fetchApi<StatsResponse>('/api/stats');

export const getSuggestions = () =>
  fetchApi<PolicySuggestion[]>('/api/stats/suggestions');

// ---------------------------------------------------------------------------
// Activity Feed
// ---------------------------------------------------------------------------

export interface ActivityItem {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  riskTier: string;
  adapter: string | null;
  taskId: string | null;
  sessionId: string | null;
  status: string;
  createdAt: string;
  agent: { name: string; pubkey: string; trustLevel: string };
  approval: {
    id: string;
    status: string;
    approver: string | null;
    reason: string | null;
    ttlSeconds: number;
    createdAt: string;
    decidedAt: string | null;
  } | null;
  execution: {
    status: string;
    exitCode: number | null;
    durationMs: number | null;
  } | null;
  receipt: { hash: string; policyDecision: string } | null;
  humanDescription: string;
  riskExplanation: string;
}

export interface ActivityResponse {
  data: ActivityItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ActivityFilters {
  page?: number;
  pageSize?: number;
  riskTier?: string;
  status?: string;
  agent?: string;
  search?: string;
}

export interface ActivitySummary {
  total: number;
  pending: number;
  recentCount: number;
}

export const getActivity = (filters: ActivityFilters = {}) =>
  fetchApi<ActivityResponse>(`/api/activity${toQueryString(filters as Record<string, string | number | boolean | undefined>)}`);

export const getActivitySummary = () =>
  fetchApi<ActivitySummary>('/api/activity/summary');

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionListItem {
  sessionKey: string;
  toolCallCount: number;
  pendingApprovals: number;
  startedAt: string | null;
  lastActivityAt: string | null;
  agent: { name: string; pubkey: string } | null;
}

export interface SessionStep {
  stepNumber: number;
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  riskTier: string;
  adapter: string | null;
  status: string; // completed | blocked | failed | denied
  isDeferred: boolean;
  createdAt: string;
  humanDescription: string;
  riskExplanation: string;
  approval: {
    id: string;
    status: string;
    approver: string | null;
    reason: string | null;
    ttlSeconds: number;
    decidedAt: string | null;
  } | null;
  execution: {
    status: string;
    exitCode: number | null;
    durationMs: number | null;
    stdout: string | null;
    stderr: string | null;
  } | null;
  receipt: { hash: string; policyDecision: string } | null;
}

export interface SessionStatus {
  sessionKey: string;
  agent: { name: string; pubkey: string; trustLevel: string };
  summary: {
    totalSteps: number;
    completed: number;
    blocked: number;
    failed: number;
    denied: number;
  };
  startedAt: string;
  lastActivityAt: string;
  steps: SessionStep[];
}

export const getSessions = () =>
  fetchApi<SessionListItem[]>('/api/sessions');

export const getSessionStatus = (sessionKey: string) =>
  fetchApi<SessionStatus>(`/api/sessions/${encodeURIComponent(sessionKey)}/status`);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditEntry {
  toolCall: ToolCall & { riskTier: string; agentPubkey: string; createdAt: string };
  approval?: Approval;
  receipt?: Receipt;
  humanDescription: string;
  riskExplanation: string;
  agentName: string;
}

export interface AuditLogResponse {
  data: AuditEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditFlag {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  agentPubkey?: string;
  toolCallId?: string;
  metadata?: string;
  dismissed: boolean;
  createdAt: string;
}

export interface AuditFlagsResponse {
  data: AuditFlag[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AuditLogFilters {
  page?: number;
  pageSize?: number;
  riskTier?: string;
  decision?: string;
  search?: string;
}

export interface AuditFlagFilters {
  page?: number;
  pageSize?: number;
  severity?: string;
  category?: string;
  dismissed?: boolean;
}

export const getAuditLog = (filters: AuditLogFilters = {}) =>
  fetchApi<AuditLogResponse>(`/api/audit/log${toQueryString(filters as Record<string, string | number | boolean | undefined>)}`);

export const getAuditFlags = (filters: AuditFlagFilters = {}) =>
  fetchApi<AuditFlagsResponse>(`/api/audit/flags${toQueryString(filters as Record<string, string | number | boolean | undefined>)}`);

export const dismissFlag = (id: string) =>
  fetchApi<void>(`/api/audit/flags/${id}/dismiss`, { method: 'POST' });

export const runAnalysis = () =>
  fetchApi<{ flagsCreated: number }>('/api/audit/analyze', { method: 'POST' });

// ---------------------------------------------------------------------------
// Analysis + Identity
// ---------------------------------------------------------------------------

import type {
  Analysis,
  AgentInsights,
  LineageNode,
  Canary,
  SpawnAgentRequest,
  TrustOverrideRequest,
  CreateCanaryRequest,
} from '@wooblay/types';

export const getTaskAnalysis = (taskId: string) =>
  fetchApi<Analysis[]>(`/api/tasks/${taskId}/analysis`);

export const getAgentInsights = (pubkey: string) =>
  fetchApi<AgentInsights>(`/api/agents/${pubkey}/insights`);

export const getAgentLineage = (pubkey: string) =>
  fetchApi<LineageNode>(`/api/agents/${pubkey}/lineage`);

export const recomputeAnalysis = (taskId: string) =>
  fetchApi<{ taskId: string; analysesCreated: number }>(`/api/analysis/recompute?taskId=${taskId}`, {
    method: 'POST',
  });

export const spawnAgent = (body: SpawnAgentRequest) =>
  fetchApi<{ agentId: string; attestationId: string; trustScore: number; trustLevel: string }>(
    '/api/agents/spawn',
    { method: 'POST', body: JSON.stringify(body) },
  );

export const overrideTrust = (pubkey: string, body: TrustOverrideRequest) =>
  fetchApi<{ pubkey: string; trustLevel: string; trustScore: number }>(
    `/api/agents/${pubkey}/trust/override`,
    { method: 'POST', body: JSON.stringify(body) },
  );

export const getCanaries = () => fetchApi<Canary[]>('/api/canaries');

export const createCanary = (body: CreateCanaryRequest) =>
  fetchApi<Canary>('/api/canaries', { method: 'POST', body: JSON.stringify(body) });

export const deleteCanary = (id: string) =>
  fetchApi<void>(`/api/canaries/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

import type { AdapterDescriptor } from '@wooblay/types';

export const getAdapters = () => fetchApi<AdapterDescriptor[]>('/api/adapters');

// ---------------------------------------------------------------------------
// Runtime Config
// ---------------------------------------------------------------------------

export interface RuntimeConfigValue {
  key: string;
  label: string;
  description: string;
  type: string;
  secret: boolean;
  defaultValue: string;
  category: string;
  value: string;
  isSet: boolean;
}

export interface RuntimeConfigResponse {
  schema: Array<{
    key: string;
    label: string;
    description: string;
    type: string;
    secret: boolean;
    category: string;
  }>;
  values: RuntimeConfigValue[];
}

export interface RuntimeStatus {
  gate: { uptime: number; memoryMB: number; nodeVersion: string };
  containers: Array<{ name: string; status: string; uptime: string }>;
  environment: string;
}

export const getRuntimeConfig = () =>
  fetchApi<RuntimeConfigResponse>('/api/runtime/config');

export const updateRuntimeConfig = (updates: Record<string, string>) =>
  fetchApi<{ updated: string[]; message: string }>('/api/runtime/config', {
    method: 'POST',
    body: JSON.stringify({ updates }),
  });

export const restartRuntime = () =>
  fetchApi<{ restarted: boolean; message: string }>('/api/runtime/restart', {
    method: 'POST',
  });

export const getRuntimeStatus = () =>
  fetchApi<RuntimeStatus>('/api/runtime/status');

// ---------------------------------------------------------------------------
// Chat (Direct API proxy to OpenClaw)
// ---------------------------------------------------------------------------

export interface ChatSendResponse {
  ok: boolean;
  message: string;
  result?: unknown;
  error?: string;
}

export interface ChatStatus {
  reachable: boolean;
  gateway: string;
  details?: unknown;
  error?: string;
}

export const sendChatMessage = (message: string, agentId?: string) =>
  fetchApi<ChatSendResponse>('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({ message, agentId }),
  });

export const getChatStatus = () =>
  fetchApi<ChatStatus>('/api/chat/status');

// ---------------------------------------------------------------------------
// Instances (Multi-Agent Deployment)
// ---------------------------------------------------------------------------

export interface Instance {
  id: string;
  name: string;
  status: string;
  agentRuntime: string;
  model: string;
  configJson: string | null;
  containerId: string | null;
  telegramBot: string | null;
  endpoint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInstanceRequest {
  name: string;
  agentRuntime?: string;
  model?: string;
  anthropicApiKey?: string;
  telegramBotToken?: string;
  telegramAllowedUsers?: string;
  telegramEnabled?: boolean;
  policyPreset?: string;
  configOverrides?: Record<string, string>;
}

export interface InstanceActionResponse {
  ok: boolean;
  message: string;
  containerId?: string;
}

export const getInstances = () =>
  fetchApi<Instance[]>('/api/instances');

export const getInstance = (id: string) =>
  fetchApi<Instance>(`/api/instances/${id}`);

export const createInstance = (body: CreateInstanceRequest) =>
  fetchApi<Instance>('/api/instances', {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const updateInstance = (id: string, body: Partial<CreateInstanceRequest>) =>
  fetchApi<Instance>(`/api/instances/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

export const startInstance = (id: string) =>
  fetchApi<InstanceActionResponse>(`/api/instances/${id}/start`, { method: 'POST' });

export const stopInstance = (id: string) =>
  fetchApi<InstanceActionResponse>(`/api/instances/${id}/stop`, { method: 'POST' });

export const restartInstance = (id: string) =>
  fetchApi<InstanceActionResponse>(`/api/instances/${id}/restart`, { method: 'POST' });

export const deleteInstance = (id: string) =>
  fetchApi<void>(`/api/instances/${id}`, { method: 'DELETE' });

export const getInstanceLogs = (id: string, tail?: number) =>
  fetchApi<{ logs: string }>(`/api/instances/${id}/logs${tail ? `?tail=${tail}` : ''}`);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const getHealth = () => fetchApi<HealthResponse>('/health');
