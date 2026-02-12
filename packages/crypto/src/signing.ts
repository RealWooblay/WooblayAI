import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { loadPublicKey, loadPrivateKey } from './keys.js';
import { canonicalJson } from './canonical.js';

/**
 * Sign a payload using ed25519 private key.
 * Payload is canonicalized before signing.
 * Returns hex-encoded signature.
 */
export function sign(payload: unknown, privateKeyHex: string): string {
  const key = loadPrivateKey(privateKeyHex);
  const data = Buffer.from(canonicalJson(payload), 'utf-8');
  const signature = cryptoSign(null, data, key);
  return signature.toString('hex');
}

/**
 * Verify a signature over a canonicalized payload using ed25519 public key.
 */
export function verify(payload: unknown, signatureHex: string, publicKeyHex: string): boolean {
  try {
    const key = loadPublicKey(publicKeyHex);
    const data = Buffer.from(canonicalJson(payload), 'utf-8');
    const signature = Buffer.from(signatureHex, 'hex');
    return cryptoVerify(null, data, key, signature);
  } catch {
    return false;
  }
}
