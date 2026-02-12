import type { Decision } from '../domain/policy.js';

export type GateDecision = 'EXECUTE' | 'DENY' | 'PENDING_APPROVAL';

export interface ToolExecuteResponse {
  decision: GateDecision;
  toolCallId: string;
  approvalId?: string;
  reason?: string;
  receiptId?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
  timestamp: string;
}

export interface StatsResponse {
  totalToolCalls: number;
  totalReceipts: number;
  pendingApprovals: number;
  agentsRegistered: number;
  byDecision: Record<string, number>;
  byRiskTier: Record<string, number>;
  byTool: Record<string, number>;
}

export interface PolicySuggestion {
  toolName: string;
  currentDecision: Decision;
  suggestedDecision: Decision;
  reason: string;
  failureRate: number;
  sampleSize: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
