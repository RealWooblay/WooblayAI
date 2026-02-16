export type ConnectionProvider = 'github';
export type ConnectionStatus = 'active' | 'revoked' | 'error';

export interface Connection {
  id: string;
  provider: ConnectionProvider;
  name: string;
  status: ConnectionStatus;
  credentialRef: string;
  scopes: string[];
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}
