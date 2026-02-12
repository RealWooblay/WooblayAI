import { GateClient, type GateClientConfig } from '@wooblay/gate-client';
import { getAgentIdentity } from '../identity/agent.js';

const DEFAULT_GATE_URL = 'http://localhost:4800';

/**
 * Create and export a pre-configured GateClient instance.
 *
 * Reads the Gate URL from WOOBLAY_GATE_URL (defaults to localhost:4800)
 * and authenticates using the toolhost agent identity.
 */
export function createGateClient(): GateClient {
  const identity = getAgentIdentity();
  const baseUrl = process.env.WOOBLAY_GATE_URL || DEFAULT_GATE_URL;

  const config: GateClientConfig = {
    baseUrl,
    agentPubkey: identity.publicKey,
    agentPrivateKey: identity.privateKey,
  };

  return new GateClient(config);
}
