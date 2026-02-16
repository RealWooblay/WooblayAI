export interface Capability {
  id: string;
  runId: string;
  workspaceId: string | null;
  actionClass: string;
  scope: CapabilityScope;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedCount: number;
  maxUses: number;
  createdAt: string;
}

export interface CapabilityScope {
  provider: string;
  repo?: string;
  branch?: string;
  permissions?: string[];
  [key: string]: unknown;
}

export interface CapabilityValidationResult {
  valid: boolean;
  reason?: string;
  capability?: Capability;
}
