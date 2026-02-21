export type ConnectionProvider = 'github';
export type ConnectionStatus = 'active' | 'revoked' | 'error';

export interface Connection {
  id: string;
  orgId: string | null;
  provider: ConnectionProvider;
  name: string;
  status: ConnectionStatus;
  authMode: string;
  credentialRef: string;
  scopes: string[];
  metadata: Record<string, unknown> | null;
  // Sensor fields
  sensorEnabled: boolean;
  sensorConfig: Record<string, unknown> | null;
  webhookSecret: string | null;
  createdAt: string;
  updatedAt: string;
}
