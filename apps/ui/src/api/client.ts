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
    'Content-Type': 'application/json',
    ...(init?.headers as Record<string, string> ?? {}),
  };

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
// Health
// ---------------------------------------------------------------------------

export const getHealth = () => fetchApi<{ status: string; version: string }>('/health');
