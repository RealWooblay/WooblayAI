import { sign, canonicalJson } from '@wooblay/crypto';

export interface AuthHeaders {
  [key: string]: string;
  'x-agent-pubkey': string;
  'x-request-signature': string;
}

/**
 * Create authentication headers for a Gate API request.
 */
export function createAuthHeaders(
  payload: unknown,
  agentPubkey: string,
  agentPrivateKey: string,
): AuthHeaders {
  const signature = sign(payload, agentPrivateKey);
  return {
    'x-agent-pubkey': agentPubkey,
    'x-request-signature': signature,
  };
}
