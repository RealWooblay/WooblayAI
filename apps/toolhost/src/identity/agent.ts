import type { KeyPair } from '@wooblay/crypto';

/**
 * Agent identity for the Tool Host, loaded from environment variables.
 *
 * WOOBLAY_TOOLHOST_PRIVATE_KEY – hex-encoded ed25519 private key (DER/PKCS8)
 * WOOBLAY_TOOLHOST_PUBLIC_KEY  – hex-encoded ed25519 public key (DER/SPKI)
 */
export function getAgentIdentity(): KeyPair {
  const privateKey = process.env.WOOBLAY_TOOLHOST_PRIVATE_KEY;
  const publicKey = process.env.WOOBLAY_TOOLHOST_PUBLIC_KEY;

  if (!privateKey) {
    throw new Error(
      'Missing WOOBLAY_TOOLHOST_PRIVATE_KEY environment variable. ' +
        'Generate a keypair with `wooblay keygen` and set the env vars.',
    );
  }

  if (!publicKey) {
    throw new Error(
      'Missing WOOBLAY_TOOLHOST_PUBLIC_KEY environment variable. ' +
        'Generate a keypair with `wooblay keygen` and set the env vars.',
    );
  }

  return { publicKey, privateKey };
}
