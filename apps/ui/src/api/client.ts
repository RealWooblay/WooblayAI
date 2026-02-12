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

export function setGetTokenFn(fn: () => Promise<string | null>) {
  getTokenFn = fn;
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

  // Attach Clerk JWT if available
  if (getTokenFn) {
    try {
      const token = await getTokenFn();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch {
      // Token retrieval failed — proceed without auth (will get 401 from server)
    }
  }

  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
  const res = await fetch(url, { ...init, headers, credentials: 'include' });

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
  createdAt: string;
  updatedAt: string;
}

export interface PolicyPresetInfo {
  id: string;
  name: string;
  description: string;
  ruleCount: number;
}

export const getPolicies = () => fetchApi<PolicyRule[]>('/api/policies');
export const getPresets = () => fetchApi<PolicyPresetInfo[]>('/api/policies/presets');

export const createPolicy = (body: { matchTool: string; riskTier: string; decision: string; matchArgs?: string; matchCategory?: string; source?: string; description?: string }) =>
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

export const optimizePolicies = (autoApply?: boolean) =>
  fetchApi<AIPolicyOptimizeResult>('/api/policies/ai-optimize', {
    method: 'POST',
    body: JSON.stringify({ autoApply: autoApply ?? false }),
  });

export const updatePolicy = (id: string, body: Partial<PolicyRule>) =>
  fetchApi<PolicyRule>(`/api/policies/${id}`, { method: 'PATCH', body: JSON.stringify(body) });

export const deletePolicy = (id: string) =>
  fetchApi<void>(`/api/policies/${id}`, { method: 'DELETE' });

export const applyPreset = (name: string) =>
  fetchApi<{ preset: string; description: string; rules: PolicyRule[] }>(`/api/policies/presets/${name}`, { method: 'POST', body: '{}' });

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
  fetchApi<AuditFlag>(`/api/flags/${id}/dismiss`, { method: 'POST' });

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
