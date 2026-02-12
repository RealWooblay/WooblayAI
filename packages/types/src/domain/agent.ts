import type { TrustLevel } from './analysis.js';

export type AgentStatus = 'active' | 'suspended' | 'revoked';

export interface Agent {
  id: string;
  pubkey: string;
  name: string;
  status: AgentStatus;
  allowlisted: boolean;
  trustLevel: TrustLevel;
  trustScore: number;
  parentPubkey: string | null;
  spawnDepth: number;
  profileJson: string | null;
  baselineJson: string | null;
  createdAt: string;
  updatedAt: string;
}
