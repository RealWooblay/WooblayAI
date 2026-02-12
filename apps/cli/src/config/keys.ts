import { existsSync } from 'node:fs';
import { loadKeyPairFromDisk, storeKeyPair, type KeyPair } from '@wooblay/crypto';
import { KEYS_DIR } from './paths.js';

/**
 * Load a named keypair from ~/.wooblay/keys/.
 * Returns null if the keys don't exist yet.
 */
export function loadKeys(name: string): KeyPair | null {
  const pubPath = `${KEYS_DIR}/${name}.pub`;
  const keyPath = `${KEYS_DIR}/${name}.key`;

  if (!existsSync(pubPath) || !existsSync(keyPath)) {
    return null;
  }

  return loadKeyPairFromDisk(KEYS_DIR, name);
}

/**
 * Store a named keypair to ~/.wooblay/keys/ with secure permissions.
 */
export function saveKeys(name: string, kp: KeyPair): void {
  storeKeyPair(KEYS_DIR, name, kp);
}

/**
 * Check if a named keypair exists in ~/.wooblay/keys/.
 */
export function keysExist(name: string): boolean {
  const pubPath = `${KEYS_DIR}/${name}.pub`;
  const keyPath = `${KEYS_DIR}/${name}.key`;
  return existsSync(pubPath) && existsSync(keyPath);
}
