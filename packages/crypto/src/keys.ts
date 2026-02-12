import { generateKeyPairSync, createPublicKey, createPrivateKey, type KeyObject } from 'node:crypto';
import { writeFileSync, readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export interface KeyPair {
  publicKey: string;   // hex-encoded
  privateKey: string;  // hex-encoded
}

/**
 * Generate a new ed25519 keypair, returning hex-encoded keys.
 */
export function generateKeyPair(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');

  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });

  return {
    publicKey: pubDer.toString('hex'),
    privateKey: privDer.toString('hex'),
  };
}

/**
 * Load an ed25519 public key from hex-encoded DER.
 */
export function loadPublicKey(hex: string): KeyObject {
  return createPublicKey({
    key: Buffer.from(hex, 'hex'),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Load an ed25519 private key from hex-encoded DER.
 */
export function loadPrivateKey(hex: string): KeyObject {
  return createPrivateKey({
    key: Buffer.from(hex, 'hex'),
    format: 'der',
    type: 'pkcs8',
  });
}

/**
 * Store a keypair to disk with secure permissions.
 */
export function storeKeyPair(basePath: string, name: string, kp: KeyPair): void {
  mkdirSync(basePath, { recursive: true });
  const pubPath = `${basePath}/${name}.pub`;
  const keyPath = `${basePath}/${name}.key`;

  writeFileSync(pubPath, kp.publicKey, 'utf-8');
  writeFileSync(keyPath, kp.privateKey, 'utf-8');
  chmodSync(keyPath, 0o600);
}

/**
 * Load a keypair from disk.
 */
export function loadKeyPairFromDisk(basePath: string, name: string): KeyPair {
  const pubPath = `${basePath}/${name}.pub`;
  const keyPath = `${basePath}/${name}.key`;

  return {
    publicKey: readFileSync(pubPath, 'utf-8').trim(),
    privateKey: readFileSync(keyPath, 'utf-8').trim(),
  };
}
