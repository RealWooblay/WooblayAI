/**
 * Wooblay API client.
 *
 * All API calls go through `fetchApi` which:
 *   1. Prepends the API base URL (VITE_API_URL or relative)
 *   2. Attaches the Clerk JWT if available
 *   3. Handles errors consistently
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = import.meta.env.VITE_API_URL ?? '';

/** Set by the auth provider to supply the current JWT. */
let getTokenFn: (() => Promise<string | null>) | null = null;
/** Force-fresh variant that always bypasses Clerk's token cache. Set by useAuthSetup. */
let getTokenFreshFn: (() => Promise<string | null>) | null = null;

export function setGetTokenFn(fn: () => Promise<string | null>) {
  getTokenFn = fn;
}
export function setGetTokenFreshFn(fn: () => Promise<string | null>) {
  getTokenFreshFn = fn;
}

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
  _retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> ?? {}),
  };

  // Only set Content-Type for requests that have a body
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'DELETE' && method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  } else if (init?.body) {
    headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
  }

  // Attach Clerk JWT — use fresh token on retry
  const tokenFn = _retried ? (getTokenFreshFn ?? getTokenFn) : getTokenFn;
  if (tokenFn) {
    try {
      const token = await tokenFn();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        console.warn('[wooblay] getToken() returned null — request will be unauthenticated:', path);
      }
    } catch (err) {
      console.error('[wooblay] getToken() failed — request will be unauthenticated:', path, err);
    }
  } else {
    console.warn('[wooblay] No token function set — auth not initialized');
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { ...init, headers, credentials: 'include' });

  // On 401, retry once with a forced-fresh token from Clerk
  if (res.status === 401 && !_retried && getTokenFn) {
    return fetchApi<T>(path, init, true);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, res.statusText, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Users / Auth
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  clerkId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  activated: boolean;
  createdAt: string;
}

export const getMe = () => fetchApi<UserProfile>('/api/users/me');

export const redeemCoupon = (code: string) =>
  fetchApi<{ ok: boolean; message: string }>('/api/coupons/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export interface ApprovalItem {
  id: string;
  status: string;
  approver: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  ttlSeconds: number;
  toolCall?: {
    id: string;
    toolName: string;
    args: string;
    riskTier: string;
    agentPubkey: string;
    taskId: string | null;
    createdAt: string;
  };
  humanDescription?: string;
  riskExplanation?: string;
  whyFlagged?: string;
}

export const getApprovals = () =>
  fetchApi<ApprovalItem[]>('/api/approvals/pending');

export const approveApproval = (id: string, body: { approver: string; reason?: string }) =>
  fetchApi<ApprovalItem>(`/api/approvals/${id}/approve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const denyApproval = (id: string, body: { approver: string; reason?: string }) =>
  fetchApi<ApprovalItem>(`/api/approvals/${id}/deny`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatsResponse {
  totalToolCalls: number;
  totalReceipts: number;
  pendingApprovals: number;
  totalAgents: number;
  byDecision: Record<string, number>;
  byRiskTier: Record<string, number>;
  byTool: Record<string, number>;
}

export const getStats = () => fetchApi<StatsResponse>('/api/stats');

export const getSuggestions = () =>
  fetchApi<Array<{ tool: string; currentDecision: string; suggestedDecision: string; reason: string }>>('/api/stats/suggestions');

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

export const getActivity = (filters: ActivityFilters = {}) =>
  fetchApi<ActivityResponse>(`/api/activity${toQueryString(filters as Record<string, string | number | boolean | undefined>)}`);

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

export interface Instance {
  id: string;
  name: string;
  userId: string | null;
  status: string;
  agentRuntime: string;
  model: string;
  configJson: string | null;
  containerId: string | null;
  telegramBot: string | null;
  githubPat: boolean;
  endpoint: string | null;
  inferredRole: string | null;
  role: string | null;
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
  githubToken?: string;
  policyPreset?: string;
  role?: string;
  goal?: string;
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

// ── Instance Secrets (agent-visible env vars) ─────────────────────────

export const getInstanceSecrets = (id: string) =>
  fetchApi<{ secrets: { key: string }[] }>(`/api/instances/${id}/secrets`);

export const addInstanceSecret = (id: string, secret: { key: string; value: string }) =>
  fetchApi<{ key: string }>(`/api/instances/${id}/secrets`, {
    method: 'POST',
    body: JSON.stringify(secret),
  });

export const deleteInstanceSecret = (id: string, key: string) =>
  fetchApi<void>(`/api/instances/${id}/secrets/${key}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

export interface PolicyRule {
  id: string;
  priority: number;
  matchTool: string;
  matchArgs: string | null;
  matchCategory: string | null;
  riskTier: string;
  decision: string;
  constraints: string | null;
  source: string;
  description: string | null;
  enabled: boolean;
  instanceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PolicyPresetInfo {
  id: string;
  name: string;
  description: string;
  ruleCount: number;
}

export const getPolicies = (instanceId?: string) =>
  fetchApi<PolicyRule[]>(`/api/policies${toQueryString({ instanceId })}`);
export const getPresets = () => fetchApi<PolicyPresetInfo[]>('/api/policies/presets');

export const createPolicy = (body: { matchTool: string; riskTier: string; decision: string; matchArgs?: string; matchCategory?: string; source?: string; description?: string; instanceId?: string }) =>
  fetchApi<PolicyRule>('/api/policies', { method: 'POST', body: JSON.stringify(body) });

export interface AIPolicySuggestion {
  action: string;
  matchCategory: string;
  matchTool: string;
  riskTier: string;
  decision: string;
  description: string;
  reasoning: string;
}

export interface AIPolicyOptimizeResult {
  suggestions: AIPolicySuggestion[];
  summary: string;
  applied: boolean;
  agentRole: string;
}

export const optimizePolicies = (autoApply?: boolean, instanceId?: string, prompt?: string) =>
  fetchApi<AIPolicyOptimizeResult>('/api/policies/ai-optimize', {
    method: 'POST',
    body: JSON.stringify({ autoApply: autoApply ?? false, instanceId, prompt }),
  });

export const updatePolicy = (id: string, body: Partial<PolicyRule>) =>
  fetchApi<PolicyRule>(`/api/policies/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deletePolicy = (id: string) =>
  fetchApi<void>(`/api/policies/${id}`, { method: 'DELETE' });

export const applyPreset = (name: string, instanceId?: string) =>
  fetchApi<{ preset: string; description: string; rules: PolicyRule[] }>(`/api/policies/presets/${name}${toQueryString({ instanceId })}`, { method: 'POST', body: '{}' });

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export interface AuditFlag {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  agentPubkey: string | null;
  toolCallId: string | null;
  metadata: string | null;
  dismissed: boolean;
  createdAt: string;
}

export interface FlagsResponse {
  flags: AuditFlag[];
  total: number;
  summary: Record<string, number>;
}

export const getFlags = (params?: { severity?: string; dismissed?: string; limit?: string }) =>
  fetchApi<FlagsResponse>(`/api/flags${toQueryString(params as Record<string, string | number | boolean | undefined> ?? {})}`);

export const dismissFlag = (id: string) =>
  fetchApi<AuditFlag>(`/api/flags/${id}/dismiss`, { method: 'POST', body: '{}' });

export const dismissAllFlags = () =>
  fetchApi<{ dismissed: number }>('/api/flags/dismiss-all', { method: 'POST', body: '{}' });

export interface DismissedFlagsResponse {
  flags: AuditFlag[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const getDismissedFlags = (page = 1, pageSize = 10) =>
  fetchApi<DismissedFlagsResponse>(`/api/flags/dismissed?page=${page}&pageSize=${pageSize}`);

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditReportRow {
  timestamp: string;
  receiptId: string;
  receiptHash: string;
  agentPubkey: string;
  toolName: string;
  description: string;
  riskTier: string;
  policyDecision: string;
  approvalStatus: string | null;
  approver: string | null;
  approvalDecision: string | null;
  approvalWaitMs: number | null;
  executionStatus: string | null;
  executionExitCode: number | null;
  signatureValid: boolean;
}

export interface AuditReport {
  period: { from: string; to: string };
  summary: {
    totalActions: number;
    autoAllowed: number;
    humanApproved: number;
    denied: number;
    approvalRate: string;
    avgApprovalTimeMs: number;
  };
  rows: AuditReportRow[];
}

export interface ChainIntegrity {
  period: { from: string; to: string };
  totalReceipts: number;
  chainValid: boolean;
  gaps: Array<{ index: number; receiptId: string; expected: string | null; actual: string | null }>;
  hashesVerified: number;
  hashErrors: number;
}

export const getAuditReport = (from: string, to: string, format?: string) =>
  fetchApi<AuditReport>(`/api/audit/report${toQueryString({ from, to, format })}`);

export const getAuditReportCsv = (from: string, to: string) =>
  fetch(`${API_BASE}/api/audit/report?from=${from}&to=${to}&format=csv`).then(r => r.text());

export const getChainIntegrity = (from?: string, to?: string) =>
  fetchApi<ChainIntegrity>(`/api/audit/chain-integrity${toQueryString({ from, to })}`);

// ---------------------------------------------------------------------------
// Mission / Observability
// ---------------------------------------------------------------------------

export interface AgentIdentity {
  baseRole: string | null;
  inferredRole: string | null;
  evolvedSoul: string | null;
  evolvedIdentity: string | null;
  identityLastUpdated: string | null;
  source: 'user-set' | 'ai-inferred' | 'agent-evolved' | 'none';
}

export interface MissionData {
  instanceId: string;
  instanceName: string;
  status: string;
  goal: string;
  currentStep: string;
  progress: { total: number; completed: number; pending: number; denied: number };
  pipeline: { PLANNING: number; EXECUTING: number; AWAITING_APPROVAL: number; COMPLETED: number };
  blockedActions: number;
  subAgents: Array<{ sessionId: string; lastAction: string; status: string }>;
  trustScore: number;
  trustTrend: 'up' | 'down' | 'stable';
  estimatedCost: number;
  costBurnRate: number;
  role: string | null;
  inferredRole: string | null;
  roleOverridden: boolean;
  categoryBreakdown: Record<string, number>;
  lastActionCategory: string | null;
  identity?: AgentIdentity;
}

export const getMission = (instanceId: string) =>
  fetchApi<MissionData>(`/api/instances/${instanceId}/mission`);

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface Webhook {
  id: string;
  userId: string;
  url: string;
  events: string;
  active: boolean;
  createdAt: string;
}

export const getWebhooks = () => fetchApi<Webhook[]>('/api/webhooks');
export const createWebhook = (body: { url: string; events: string[] }) =>
  fetchApi<Webhook>('/api/webhooks', { method: 'POST', body: JSON.stringify(body) });
export const deleteWebhook = (id: string) =>
  fetchApi<void>(`/api/webhooks/${id}`, { method: 'DELETE' });
export const testWebhook = (id: string) =>
  fetchApi<{ success: boolean; status?: number }>(`/api/webhooks/${id}/test`, { method: 'POST' });

// ---------------------------------------------------------------------------
// Session Playback
// ---------------------------------------------------------------------------

export interface SessionEvent {
  id: string;
  timestamp: string;
  toolName: string;
  description: string;
  riskTier: string;
  status: string;
  color: string;
  approver: string | null;
  approvalWaitMs: number | null;
  executionResult: { status: string; exitCode: number | null; durationMs: number | null } | null;
  receiptHash: string | null;
}

export interface SessionPlaybackData {
  sessionId: string;
  events: SessionEvent[];
  stats: {
    totalEvents: number;
    totalDurationMs: number;
    decisionsMade: number;
    avgApprovalTimeMs: number;
    denied: number;
    autoAllowed: number;
    humanApproved: number;
  };
}

export const getSessionPlayback = (sessionId: string) =>
  fetchApi<SessionPlaybackData>(`/api/sessions/${sessionId}/playback`);

// ---------------------------------------------------------------------------
// Trust & Contributions
// ---------------------------------------------------------------------------

export interface TrustResult {
  score: number;
  breakdown: Record<string, number>;
  trend: 'up' | 'down' | 'stable';
}

export interface ContributionResult {
  summary: {
    filesCreated: number;
    filesEdited: number;
    commandsExecuted: number;
    linesWritten: number;
    prsAndCommits: number;
    researchActions: number;
    approvalEfficiency: string;
    denialRate: string;
    totalActions: number;
  };
  byCategory: { planning: number; executing: number; blocked: number };
  byDay: Array<{ date: string; count: number }>;
}

export const getAgentTrust = (pubkey: string) =>
  fetchApi<TrustResult>(`/api/agents/${pubkey}/trust`);

export const getInstanceContributions = (instanceId: string) =>
  fetchApi<ContributionResult>(`/api/instances/${instanceId}/contributions`);

export const getInstanceCost = (instanceId: string) =>
  fetchApi<{ totalCost: number; costToday: number; costThisWeek: number; burnRatePerHour: number; actionCount: number }>(`/api/instances/${instanceId}/cost`);

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export const getHealth = () => fetchApi<{ status: string; version: string }>('/health');

// ---------------------------------------------------------------------------
// Workspace File Explorer
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  modified: string | null;
}

export interface FileListResult {
  path: string;
  entries: FileEntry[];
}

export interface FileReadResult {
  path: string;
  content: string;
  size: number;
  truncated: boolean;
  warning?: string;
}

export const listFiles = (instanceId: string, path?: string) =>
  fetchApi<FileListResult>(`/api/instances/${instanceId}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`);

export const readFile = (instanceId: string, path: string) =>
  fetchApi<FileReadResult>(`/api/instances/${instanceId}/files/read?path=${encodeURIComponent(path)}`);

export const getFileDownloadUrl = (instanceId: string, path: string) =>
  `/api/instances/${instanceId}/files/download?path=${encodeURIComponent(path)}`;

export const writeFile = (instanceId: string, path: string, content: string) =>
  fetchApi<{ ok: boolean; path: string; size: number }>(`/api/instances/${instanceId}/files/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content }),
  });

// ── Operations (was Incidents) ───────────────────────────────────────────

export const getOperations = (params?: { status?: string; priority?: string; routingStatus?: string; limit?: number }) =>
  fetchApi<{ operations: any[]; total: number }>(`/api/operations${toQueryString(params ?? {})}`);

export const getOperation = (id: string) => fetchApi<any>(`/api/operations/${id}`);

export const createOperation = (data: { title: string; summary?: string; priority?: string; source?: string; intent?: string; instanceId?: string }) =>
  fetchApi<any>('/api/operations', { method: 'POST', body: JSON.stringify(data) });

export const updateOperation = (id: string, data: { status?: string; priority?: string; summary?: string }) =>
  fetchApi<any>(`/api/operations/${id}`, { method: 'PATCH', body: JSON.stringify(data) });

export const routeOperation = (id: string, instanceId: string) =>
  fetchApi<any>(`/api/operations/${id}/route`, { method: 'POST', body: JSON.stringify({ instanceId }) });

export const approveOperationRouting = (id: string) =>
  fetchApi<any>(`/api/operations/${id}/approve-routing`, { method: 'POST', body: JSON.stringify({}) });

export const dismissOperation = (id: string) =>
  fetchApi<any>(`/api/operations/${id}/dismiss`, { method: 'POST', body: JSON.stringify({}) });

/** @deprecated Use getOperations */
export const getIncidents = getOperations;
/** @deprecated Use getOperation */
export const getIncident = getOperation;
/** @deprecated Use createOperation */
export const createIncident = createOperation;
/** @deprecated Use updateOperation */
export const updateIncident = updateOperation;

// ── Runs ────────────────────────────────────────────────────────────────

export const getRuns = (params?: { operationId?: string; incidentId?: string; status?: string; limit?: number }) =>
  fetchApi<{ runs: any[]; total: number }>(`/api/runs${toQueryString(params ?? {})}`);

export const getRun = (id: string) => fetchApi<any>(`/api/runs/${id}`);

export const createRun = (data: { operationId: string; priority?: string; recipe?: string; budgetCents?: number }) =>
  fetchApi<any>('/api/runs', { method: 'POST', body: JSON.stringify(data) });

export const transitionRun = (id: string, status: string, reason?: string) =>
  fetchApi<any>(`/api/runs/${id}/transition`, { method: 'POST', body: JSON.stringify({ status, reason }) });

export const pauseRun = (id: string) =>
  fetchApi<any>(`/api/runs/${id}/pause`, { method: 'POST', body: JSON.stringify({}) });

export const resumeRun = (id: string) =>
  fetchApi<any>(`/api/runs/${id}/resume`, { method: 'POST', body: JSON.stringify({}) });

export const killRun = (id: string, reason?: string) =>
  fetchApi<any>(`/api/runs/${id}/kill`, { method: 'POST', body: JSON.stringify({ reason }) });

export const getRunEvents = (id: string) => fetchApi<any[]>(`/api/runs/${id}/events`);

// ── MVP: Proposals ──────────────────────────────────────────────────────

export const getProposals = (params?: { runId?: string; status?: string }) =>
  fetchApi<any[]>(`/api/proposals${toQueryString(params ?? {})}`);

export const getProposal = (id: string) => fetchApi<any>(`/api/proposals/${id}`);

export const approveProposal = (id: string, approver?: string) =>
  fetchApi<any>(`/api/proposals/${id}/approve`, { method: 'POST', body: JSON.stringify({ approver }) });

export const denyProposal = (id: string) =>
  fetchApi<any>(`/api/proposals/${id}/deny`, { method: 'POST', body: JSON.stringify({}) });

// ── MVP: Evidence ───────────────────────────────────────────────────────

export const getEvidence = (id: string) => fetchApi<any>(`/api/evidence/${id}`);

// ── MVP: Case Files ─────────────────────────────────────────────────────

export const getCaseFile = (runId: string) => fetchApi<any>(`/api/case-files/${runId}`);

export const verifyCaseFile = (runId: string) => fetchApi<any>(`/api/case-files/${runId}/verify`);

// ── MVP: Insights ───────────────────────────────────────────────────────

export const getInsightsMetrics = (days?: number) =>
  fetchApi<any>(`/api/insights/metrics${days ? `?days=${days}` : ''}`);

export const getInsightsSummary = (days?: number) =>
  fetchApi<any>(`/api/insights/summary${days ? `?days=${days}` : ''}`);

// ── MVP: Connections ────────────────────────────────────────────────────

export const getConnections = () => fetchApi<any[]>('/api/connections');

export const createConnection = (data: { provider: string; name: string; credential: string; scopes?: string[]; metadata?: Record<string, unknown> }) =>
  fetchApi<any>('/api/connections', { method: 'POST', body: JSON.stringify(data) });

export const revokeConnection = (id: string) =>
  fetchApi<any>(`/api/connections/${id}/revoke`, { method: 'POST', body: JSON.stringify({}) });

export const testConnection = (id: string) =>
  fetchApi<any>(`/api/connections/${id}/test`, { method: 'POST', body: JSON.stringify({}) });

// ── Sensors ─────────────────────────────────────────────────────────────

export const getSensorsStatus = () => fetchApi<any>('/api/sensors/status');

export const updateSensorConfig = (connectionId: string, data: { sensorEnabled?: boolean; sensorConfig?: any }) =>
  fetchApi<any>(`/api/connections/${connectionId}/sensor`, { method: 'PATCH', body: JSON.stringify(data) });

export const getWebhookUrl = (connectionId: string) =>
  fetchApi<any>(`/api/connections/${connectionId}/webhook-url`);

export const initSensor = (connectionId: string) =>
  fetchApi<any>(`/api/connections/${connectionId}/sensor/init`, { method: 'POST', body: JSON.stringify({}) });

// ── Scope Boundaries ────────────────────────────────────────────────────

export const updateScopeBoundaries = (connectionId: string, scopeBoundaries: Record<string, { allowed: string[]; blocked: string[] }>) =>
  fetchApi<any>(`/api/connections/${connectionId}/scope-boundaries`, {
    method: 'PATCH',
    body: JSON.stringify({ scopeBoundaries }),
  });

// ── Connection Secrets ───────────────────────────────────────────────────

export const getConnectionSecrets = (connectionId: string) =>
  fetchApi<{ secrets: { key: string; mode: string }[] }>(`/api/connections/${connectionId}/secrets`);

export const setConnectionSecrets = (connectionId: string, secrets: { key: string; value: string; mode: 'agent' | 'exec_only' }[]) =>
  fetchApi<any>(`/api/connections/${connectionId}/secrets`, {
    method: 'PUT',
    body: JSON.stringify({ secrets }),
  });

export const addConnectionSecret = (connectionId: string, secret: { key: string; value: string; mode: 'agent' | 'exec_only' }) =>
  fetchApi<any>(`/api/connections/${connectionId}/secrets`, {
    method: 'POST',
    body: JSON.stringify(secret),
  });

export const deleteConnectionSecret = (connectionId: string, key: string) =>
  fetchApi<any>(`/api/connections/${connectionId}/secrets/${key}`, { method: 'DELETE' });

// ── Available Actions ───────────────────────────────────────────────────

export const getAvailableActions = () => fetchApi<any[]>('/api/actions/available');

// ── MVP: Budget ─────────────────────────────────────────────────────────

export const getBudget = () => fetchApi<any>('/api/budget');

// ── MVP: Verifications ──────────────────────────────────────────────────

export const getRunVerifications = (runId: string) =>
  fetchApi<any[]>(`/api/runs/${runId}/verifications`);

export const getVerification = (id: string) => fetchApi<any>(`/api/verifications/${id}`);

export const getVerificationStats = (runId: string) =>
  fetchApi<{ total: number; passed: number; failed: number; skipped: number; passRate: number | null }>(
    `/api/runs/${runId}/verification-stats`,
  );

// ── MVP: Rollbacks ──────────────────────────────────────────────────────

export const createRollback = (
  runId: string,
  data: { originalProposalId: string; type: string; reason: string },
) =>
  fetchApi<{ rollbackProposalId: string; status: string }>(`/api/runs/${runId}/rollback`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

export const getRunRollbacks = (runId: string) =>
  fetchApi<any[]>(`/api/runs/${runId}/rollbacks`);

// ── MVP: Repo Config ────────────────────────────────────────────────────

export const getRepoConfigs = () => fetchApi<any[]>('/api/repo-configs');

export const getRepoConfig = (repoFullName: string) =>
  fetchApi<any>(`/api/repo-configs/${encodeURIComponent(repoFullName)}`);

export const updateRepoConfig = (
  repoFullName: string,
  data: { installCmd?: string; testCmd?: string; buildCmd?: string; lintCmd?: string; timeoutSeconds?: number; branch?: string },
) =>
  fetchApi<any>(`/api/repo-configs/${encodeURIComponent(repoFullName)}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

// ── MVP: Workspaces ─────────────────────────────────────────────────────

export const createRunWorkspace = (runId: string, data: { repoUrl?: string; commitSha?: string; egressMode?: string }) =>
  fetchApi<any>(`/api/runs/${runId}/workspace`, { method: 'POST', body: JSON.stringify(data) });

export const getWorkspaces = (status?: string) =>
  fetchApi<any[]>(`/api/workspaces${status ? `?status=${status}` : ''}`);

export const getWorkspaceLogs = (workspaceId: string, tail?: number) =>
  fetchApi<{ logs: string }>(`/api/workspaces/${workspaceId}/logs${tail ? `?tail=${tail}` : ''}`);

export const stopWorkspace = (workspaceId: string) =>
  fetchApi<any>(`/api/workspaces/${workspaceId}/stop`, { method: 'POST', body: JSON.stringify({}) });

// ── MVP: Evidence Rerun ─────────────────────────────────────────────────

export const rerunEvidence = (bundleId: string) =>
  fetchApi<any>(`/api/evidence/${bundleId}/rerun`, { method: 'POST', body: JSON.stringify({}) });
