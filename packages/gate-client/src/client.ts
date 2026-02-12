import type {
  ToolExecuteRequest,
  ToolExecuteResponse,
  ApprovalDecisionRequest,
  CreateScoreRequest,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateCheckpointRequest,
  ReportExecutionRequest,
  HealthResponse,
  StatsResponse,
  PolicySuggestion,
  Approval,
  Receipt,
  PolicyRule,
  Agent,
  Score,
  Checkpoint,
  ToolCall,
} from '@wooblay/types';
import { createAuthHeaders } from './auth.js';

export interface GateClientConfig {
  baseUrl: string;
  agentPubkey?: string;
  agentPrivateKey?: string;
}

export class GateClient {
  constructor(private config: GateClientConfig) {}

  private get base() { return this.config.baseUrl.replace(/\/$/, ''); }

  private async fetch<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Gate ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  private authHeaders(payload: unknown): Record<string, string> {
    if (!this.config.agentPubkey || !this.config.agentPrivateKey) return {};
    return createAuthHeaders(payload, this.config.agentPubkey, this.config.agentPrivateKey);
  }

  // ----- Health -----
  health(): Promise<HealthResponse> {
    return this.fetch('/health');
  }

  // ----- Tool Execution -----
  async toolExecute(req: ToolExecuteRequest): Promise<ToolExecuteResponse> {
    return this.fetch('/api/tool/execute', {
      method: 'POST',
      body: JSON.stringify(req),
      headers: this.authHeaders(req),
    });
  }

  // ----- Executions -----
  async reportExecution(req: ReportExecutionRequest): Promise<void> {
    await this.fetch('/api/executions', {
      method: 'POST',
      body: JSON.stringify(req),
      headers: this.authHeaders(req),
    });
  }

  // ----- Approvals -----
  async pendingApprovals(): Promise<Approval[]> {
    return this.fetch('/api/approvals/pending');
  }

  async approveApproval(id: string, req: ApprovalDecisionRequest): Promise<Approval> {
    return this.fetch(`/api/approvals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  async denyApproval(id: string, req: ApprovalDecisionRequest): Promise<Approval> {
    return this.fetch(`/api/approvals/${id}/deny`, {
      method: 'POST',
      body: JSON.stringify(req),
    });
  }

  async getApproval(id: string): Promise<Approval> {
    return this.fetch(`/api/approvals/${id}`);
  }

  // ----- Receipts -----
  async getReceipt(hash: string): Promise<Receipt> {
    return this.fetch(`/api/receipts/${hash}`);
  }

  async verifyReceipt(hash: string): Promise<{ valid: boolean }> {
    return this.fetch(`/api/receipts/${hash}/verify`);
  }

  // ----- Policies -----
  async listPolicies(): Promise<PolicyRule[]> {
    return this.fetch('/api/policies');
  }

  async createPolicy(req: CreatePolicyRequest): Promise<PolicyRule> {
    return this.fetch('/api/policies', { method: 'POST', body: JSON.stringify(req) });
  }

  async updatePolicy(id: string, req: UpdatePolicyRequest): Promise<PolicyRule> {
    return this.fetch(`/api/policies/${id}`, { method: 'PATCH', body: JSON.stringify(req) });
  }

  async deletePolicy(id: string): Promise<void> {
    await this.fetch(`/api/policies/${id}`, { method: 'DELETE' });
  }

  // ----- Agents -----
  async listAgents(): Promise<Agent[]> {
    return this.fetch('/api/agents');
  }

  async createAgent(req: CreateAgentRequest): Promise<Agent> {
    return this.fetch('/api/agents', { method: 'POST', body: JSON.stringify(req) });
  }

  async updateAgent(id: string, req: UpdateAgentRequest): Promise<Agent> {
    return this.fetch(`/api/agents/${id}`, { method: 'PATCH', body: JSON.stringify(req) });
  }

  async deleteAgent(id: string): Promise<void> {
    await this.fetch(`/api/agents/${id}`, { method: 'DELETE' });
  }

  // ----- Scores -----
  async createScore(req: CreateScoreRequest): Promise<Score> {
    return this.fetch('/api/scores', { method: 'POST', body: JSON.stringify(req) });
  }

  // ----- Stats -----
  async getStats(): Promise<StatsResponse> {
    return this.fetch('/api/stats');
  }

  async getSuggestions(): Promise<PolicySuggestion[]> {
    return this.fetch('/api/stats/suggestions');
  }

  // ----- Timeline -----
  async getTimeline(taskId: string): Promise<{ toolCalls: ToolCall[]; approvals: Approval[]; receipts: Receipt[] }> {
    return this.fetch(`/api/tasks/${taskId}/timeline`);
  }

  // ----- Checkpoints -----
  async createCheckpoint(req: CreateCheckpointRequest): Promise<Checkpoint> {
    return this.fetch('/api/checkpoints', { method: 'POST', body: JSON.stringify(req) });
  }

  async restoreCheckpoint(id: string): Promise<void> {
    await this.fetch(`/api/checkpoints/${id}/restore`, { method: 'POST' });
  }
}
