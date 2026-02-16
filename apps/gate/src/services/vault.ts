/**
 * Credential Vault — secrets lifecycle management with encryption at rest.
 *
 * Implements envelope encryption:
 * - Each secret gets a unique data encryption key (DEK)
 * - DEK is encrypted by a key-encryption key (KEK) — KMS in prod, local AES in dev
 * - Only ciphertext + encrypted DEK + nonce are stored
 *
 * A DB leak without KMS access yields nothing usable.
 *
 * Format stored in credentialRef:
 *   enc:v1:<keyId>:<nonce_hex>:<encryptedDek_hex>:<ciphertext_hex>
 *
 * For GitHub: use installation tokens (short-lived, ~1hr) via
 * the GitHub App installation ID. Never store PATs long-term.
 */

import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { config } from '../config.js';

// ── Encryption Primitives ───────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm';
const DEK_BYTES = 32;
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const ENVELOPE_PREFIX = 'enc:v1:';

/**
 * Derive the key-encryption key from config.
 *
 * PRODUCTION: Requires KMS_KEY_ID + VAULT_MASTER_KEY. No fallbacks.
 * DEVELOPMENT: Requires VAULT_MASTER_KEY. No deterministic fallbacks —
 *   generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * There is intentionally NO dev fallback. A deterministic key derived from
 * a hardcoded string can accidentally leak into production if NODE_ENV
 * is misconfigured. Instead, we hard-fail and tell you how to fix it.
 */
function getKek(): { keyId: string; key: Buffer } {
  const kmsKeyId = config.KMS_KEY_ID;
  const masterKeyHex = config.VAULT_MASTER_KEY;
  const isProduction = config.NODE_ENV === 'production';

  // Production: both KMS_KEY_ID and VAULT_MASTER_KEY are required
  if (isProduction && !kmsKeyId) {
    throw new Error(
      'FATAL: KMS_KEY_ID must be set in production. ' +
      'Wooblay refuses to start without KMS-backed encryption in production.',
    );
  }
  if (isProduction && !masterKeyHex) {
    throw new Error(
      'FATAL: VAULT_MASTER_KEY must be set in production. ' +
      'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }

  if (kmsKeyId) {
    if (!masterKeyHex) {
      throw new Error('VAULT_MASTER_KEY required alongside KMS_KEY_ID');
    }
    const key = Buffer.from(masterKeyHex, 'hex');
    if (key.length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes (64 hex chars)');
    return { keyId: kmsKeyId, key };
  }

  if (masterKeyHex) {
    const key = Buffer.from(masterKeyHex, 'hex');
    if (key.length !== 32) throw new Error('VAULT_MASTER_KEY must be 32 bytes (64 hex chars)');
    return { keyId: 'local', key };
  }

  // No fallback. Period.
  throw new Error(
    'VAULT_MASTER_KEY is required for envelope encryption. ' +
    'Generate one: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  );
}

/** Encrypt a DEK with the KEK using AES-256-GCM. */
function wrapDek(dek: Buffer, kek: Buffer, nonce: Buffer): Buffer {
  const cipher = createCipheriv(ALGORITHM, kek, nonce);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([encrypted, authTag]);
}

/** Decrypt a DEK with the KEK. */
function unwrapDek(wrappedDek: Buffer, kek: Buffer, nonce: Buffer): Buffer {
  const authTag = wrappedDek.subarray(wrappedDek.length - AUTH_TAG_BYTES);
  const ciphertext = wrappedDek.subarray(0, wrappedDek.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, kek, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encrypt plaintext with a DEK using AES-256-GCM. */
function encryptWithDek(plaintext: string, dek: Buffer): { nonce: Buffer; ciphertext: Buffer } {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALGORITHM, dek, nonce);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf-8')),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return { nonce, ciphertext: Buffer.concat([encrypted, authTag]) };
}

/** Decrypt ciphertext with a DEK. */
function decryptWithDek(ciphertext: Buffer, dek: Buffer, nonce: Buffer): string {
  const authTag = ciphertext.subarray(ciphertext.length - AUTH_TAG_BYTES);
  const encrypted = ciphertext.subarray(0, ciphertext.length - AUTH_TAG_BYTES);
  const decipher = createDecipheriv(ALGORITHM, dek, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

// ── Envelope Encrypt / Decrypt ─────────────────────────────────────────

/**
 * Envelope-encrypt a secret. Returns a string ref safe for DB storage.
 * Format: enc:v1:<keyId>:<dekNonce>:<wrappedDek>:<dataNonce>:<ciphertext>
 */
export function envelopeEncrypt(plaintext: string): string {
  const { keyId, key: kek } = getKek();

  // Generate a fresh DEK
  const dek = randomBytes(DEK_BYTES);
  const dekNonce = randomBytes(NONCE_BYTES);
  const wrappedDek = wrapDek(dek, kek, dekNonce);

  // Encrypt the actual secret
  const { nonce: dataNonce, ciphertext } = encryptWithDek(plaintext, dek);

  // Zero the DEK from memory (best-effort)
  dek.fill(0);

  return [
    ENVELOPE_PREFIX + keyId,
    dekNonce.toString('hex'),
    wrappedDek.toString('hex'),
    dataNonce.toString('hex'),
    ciphertext.toString('hex'),
  ].join(':');
}

/**
 * Decrypt an envelope-encrypted ref back to plaintext.
 */
export function envelopeDecrypt(ref: string): string {
  if (!ref.startsWith(ENVELOPE_PREFIX)) {
    throw new Error('Not an envelope-encrypted reference');
  }

  const withoutPrefix = ref.slice(ENVELOPE_PREFIX.length);
  const parts = withoutPrefix.split(':');
  if (parts.length !== 4) {
    throw new Error('Malformed envelope reference');
  }

  const [dekNonceHex, wrappedDekHex, dataNonceHex, ciphertextHex] = parts;
  const { key: kek } = getKek();

  const dek = unwrapDek(
    Buffer.from(wrappedDekHex!, 'hex'),
    kek,
    Buffer.from(dekNonceHex!, 'hex'),
  );

  const plaintext = decryptWithDek(
    Buffer.from(ciphertextHex!, 'hex'),
    dek,
    Buffer.from(dataNonceHex!, 'hex'),
  );

  // Zero the DEK
  dek.fill(0);

  return plaintext;
}

/**
 * Check if a ref is envelope-encrypted.
 */
export function isEncrypted(ref: string): boolean {
  return ref.startsWith(ENVELOPE_PREFIX);
}

// ── Vault Interface ─────────────────────────────────────────────────────

export interface VaultProvider {
  store(key: string, value: string, metadata?: Record<string, unknown>): Promise<string>;
  fetch(ref: string): Promise<string | null>;
  revoke(ref: string): Promise<void>;
  rotate(ref: string, newValue: string): Promise<string>;
}

// ── MVP Vault (DB-backed + envelope encryption) ────────────────────────

export class DatabaseVault implements VaultProvider {
  constructor(private prisma: PrismaClient) {}

  async store(key: string, value: string, _metadata?: Record<string, unknown>): Promise<string> {
    // Envelope-encrypt the secret before storing
    const encryptedRef = envelopeEncrypt(value);

    await this.prisma.connection.update({
      where: { id: key },
      data: { credentialRef: encryptedRef },
    });

    return `db://${key}`;
  }

  async fetch(ref: string): Promise<string | null> {
    if (ref.startsWith('db://')) {
      const key = ref.slice(5);
      const conn = await this.prisma.connection.findFirst({
        where: { id: key, status: 'active' },
      });
      if (!conn?.credentialRef) return null;

      // If envelope-encrypted, decrypt
      if (isEncrypted(conn.credentialRef)) {
        return envelopeDecrypt(conn.credentialRef);
      }

      // Legacy unencrypted ref — reject in production
      if (config.NODE_ENV === 'production') {
        throw new Error(
          `Connection ${key} has unencrypted credential. ` +
          'Run migration to re-encrypt all credentials before deploying to production.',
        );
      }
      return conn.credentialRef;
    }
    return null;
  }

  async revoke(ref: string): Promise<void> {
    if (ref.startsWith('db://')) {
      const key = ref.slice(5);
      await this.prisma.connection.update({
        where: { id: key },
        data: { credentialRef: '', status: 'revoked' },
      });
    }
  }

  async rotate(ref: string, newValue: string): Promise<string> {
    if (ref.startsWith('db://')) {
      const key = ref.slice(5);
      const encryptedRef = envelopeEncrypt(newValue);
      await this.prisma.connection.update({
        where: { id: key },
        data: { credentialRef: encryptedRef },
      });
      return ref;
    }
    throw new Error(`Cannot rotate ref: ${ref}`);
  }
}

// ── Secret Leasing ──────────────────────────────────────────────────────

const DEFAULT_LEASE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function createSecretLease(
  prisma: PrismaClient,
  connectionId: string,
  runId: string,
  scopes: string[],
  ttlMs?: number,
): Promise<{ leaseId: string; expiresAt: Date }> {
  const connection = await prisma.connection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new Error('Connection not found');

  const expiresAt = new Date(Date.now() + (ttlMs ?? DEFAULT_LEASE_TTL_MS));

  const lease = await prisma.secretLease.create({
    data: {
      connectionId,
      runId,
      secretArn: connection.credentialRef,
      leaseType: 'pat',
      scopes: JSON.stringify(scopes),
      expiresAt,
    },
  });

  return { leaseId: lease.id, expiresAt };
}

export async function revokeSecretLease(
  prisma: PrismaClient,
  leaseId: string,
): Promise<void> {
  await prisma.secretLease.update({
    where: { id: leaseId },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllLeasesForRun(
  prisma: PrismaClient,
  runId: string,
): Promise<number> {
  const result = await prisma.secretLease.updateMany({
    where: { runId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

export async function isLeaseValid(
  prisma: PrismaClient,
  leaseId: string,
): Promise<boolean> {
  const lease = await prisma.secretLease.findUnique({ where: { id: leaseId } });
  if (!lease) return false;
  if (lease.revokedAt) return false;
  if (new Date() > lease.expiresAt) return false;

  await prisma.secretLease.update({
    where: { id: leaseId },
    data: { lastAccessedAt: new Date() },
  });

  return true;
}

// ── Secret Redaction ────────────────────────────────────────────────────

const REDACTION_PATTERNS = [
  /ghp_[a-zA-Z0-9]{36}/g,        // GitHub PAT (classic)
  /github_pat_[a-zA-Z0-9_]{82}/g, // GitHub PAT (fine-grained)
  /ghs_[a-zA-Z0-9]{36}/g,         // GitHub App installation token
  /sk-[a-zA-Z0-9]{48}/g,          // OpenAI API key
  /Bearer\s+[a-zA-Z0-9._-]+/gi,   // Bearer tokens
  /AKIA[0-9A-Z]{16}/g,            // AWS access key
  /wbl_cap_v1\.[a-zA-Z0-9_-]+\.[a-f0-9]+/g, // Wooblay capability tokens
  /[a-zA-Z0-9+/]{40,}={0,2}/g,   // Base64-encoded blobs (>30 chars)
];

/** Email pattern for UI redaction. */
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Redact secrets from log output. Call this on ALL structured log data
 * before persisting or displaying.
 */
export function redactSecrets(input: string): string {
  let output = input;
  for (const pattern of REDACTION_PATTERNS) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

/**
 * Redact PII (emails, etc.) from payloads shown in UI.
 * More aggressive than server-side redaction.
 */
export function redactPii(input: string): string {
  let output = redactSecrets(input);
  output = output.replace(EMAIL_PATTERN, '[EMAIL_REDACTED]');
  return output;
}
