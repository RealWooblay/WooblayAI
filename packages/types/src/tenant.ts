export interface TenantConfig {
  tenantName: string;
  agentRuntimeId: string;
  databaseUrl: string;
  serverPublicKey: string;
  serverPrivateKey: string;
  toolhostPublicKey: string;
  toolhostPrivateKey: string;
}

export interface ProvisionInput {
  tenantName: string;
  agentRuntimeId?: string; // defaults to "openclaw"
  region?: string;
}

export interface InstanceStatus {
  tenantName: string;
  agentRuntimeId: string;
  agentRuntimeName: string;
  url: string;
  healthUrl: string;
  healthy: boolean;
  createdAt: string;
  stats: {
    totalToolCalls: number;
    totalReceipts: number;
    pendingApprovals: number;
    agentsRegistered: number;
  };
}
