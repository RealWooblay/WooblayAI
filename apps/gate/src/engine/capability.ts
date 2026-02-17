/**
 * Capability Token Engine.
 *
 * Mints, validates, and revokes scoped capability tokens that bind
 * (workspace, run, action_class) to a time-bounded, max-use permission.
 *
 * Tokens are signed with the server's ed25519 key and contain structured
 * claims: v, aud, iat, exp, jti, kid, runId, workspaceId, actionClass,
 * scopeHash, policySnapshotHash.
 *
 * Key rotation: tokens include a `kid` claim. The gateway tries the
 * current public key first, then falls back to previous keys (from
 * WOOBLAY_SERVER_PUBLIC_KEYS_PREV). This allows zero-downtime rotation.
 *
 * Clock skew: ±60 seconds tolerance on exp/iat checks.
 *
 * Agents NEVER see raw credentials. They present capability tokens to the
 * Tool Gateway, which validates and uses the real credential on their behalf.
 */

import { randomBytes, createHash } from 'node:crypto';
import type { PrismaClient, Capability as PrismaCapability } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import { config } from '../config.js';
import { sign, verify, canonicalJson } from '@wooblay/crypto';
import type { KeyEntry, CapabilityClaims, MintCapabilityInput, ValidationResult } from '../types/capability.js';
export type { CapabilityClaims, MintCapabilityInput, ValidationResult };

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_MAX_USES = 10;
const TOKEN_AUD = 'wooblay:gateway';
const TOKEN_VERSION = 1;
const CLOCK_SKEW_SECONDS = 60; // ±60s tolerance

/** Get all verification keys: current + previous (for rotation). */
function getVerifyKeys(): KeyEntry[] {
  const keys: KeyEntry[] = [];

  // Current key
  if (config.WOOBLAY_SERVER_PUBLIC_KEY) {
    keys.push({
      kid: config.WOOBLAY_SERVER_KEY_ID,
      pub: config.WOOBLAY_SERVER_PUBLIC_KEY,
    });
  }

  // Previous keys for rotation
  try {
    const prev = JSON.parse(config.WOOBLAY_SERVER_PUBLIC_KEYS_PREV) as KeyEntry[];
    if (Array.isArray(prev)) {
      for (const entry of prev) {
        if (entry.kid && entry.pub) keys.push(entry);
      }
    }
  } catch {
    // Invalid JSON — skip
  }

  return keys;
}

// ── Token Claims ────────────────────────────────────────────────────────

/**
 * Encode claims into a signed token.
 * Format: wbl_cap_v1.<base64url(claims)>.<hex(ed25519_sig)>
 */
function encodeToken(claims: CapabilityClaims, privateKeyHex: string): string {
  const claimsJson = canonicalJson(claims);
  const claimsB64 = Buffer.from(claimsJson, 'utf-8').toString('base64url');
  const signature = sign(claimsJson, privateKeyHex);
  return `wbl_cap_v1.${claimsB64}.${signature}`;
}

/**
 * Decode and verify a signed token. Tries the key matching `kid` first,
 * then falls back to all known keys. Returns claims if valid.
 */
function decodeToken(token: string): CapabilityClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'wbl_cap_v1') return null;

  const claimsJson = Buffer.from(parts[1]!, 'base64url').toString('utf-8');
  const signature = parts[2]!;

  let claims: CapabilityClaims;
  try {
    claims = JSON.parse(claimsJson) as CapabilityClaims;
  } catch {
    return null;
  }

  const allKeys = getVerifyKeys();
  if (allKeys.length === 0) return null;

  // Try the key matching the token's kid first
  const preferredKey = allKeys.find((k) => k.kid === claims.kid);
  const keysToTry = preferredKey
    ? [preferredKey, ...allKeys.filter((k) => k.kid !== claims.kid)]
    : allKeys;

  for (const key of keysToTry) {
    if (verify(claimsJson, signature, key.pub)) {
      return claims;
    }
  }

  return null;
}

/** Hash a scope or policy snapshot for inclusion in claims. */
function hashJson(obj: unknown): string {
  return createHash('sha256').update(canonicalJson(obj)).digest('hex');
}

// ── Mint ────────────────────────────────────────────────────────────────

export async function mintCapability(
  prisma: PrismaClient,
  input: MintCapabilityInput,
): Promise<PrismaCapability & { token: string }> {
  // Verify the run exists and is active
  const run = await prisma.run.findUnique({ where: { id: input.runId } });
  if (!run) throw new Error(`Run not found: ${input.runId}`);
  if (!['running', 'scheduled'].includes(run.status)) {
    throw new Error(`Cannot mint capability for run in status: ${run.status}`);
  }

  const jti = randomBytes(16).toString('hex');
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();
  const expiresAt = new Date(now + ttlMs);
  const scopeHash = hashJson(input.scope);
  const policySnapshotHash = input.policySnapshot ? hashJson(input.policySnapshot) : null;

  // Build claims with kid for key rotation
  const claims: CapabilityClaims = {
    v: TOKEN_VERSION,
    aud: TOKEN_AUD,
    kid: config.WOOBLAY_SERVER_KEY_ID,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
    jti,
    runId: input.runId,
    workspaceId: input.workspaceId ?? null,
    actionClass: input.actionClass,
    scopeHash,
    policySnapshotHash,
  };

  // Sign the token
  const privateKey = config.WOOBLAY_SERVER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('WOOBLAY_SERVER_PRIVATE_KEY is required to mint capability tokens');
  }
  const token = encodeToken(claims, privateKey);

  // Persist in DB (id = jti, not the full token)
  const capability = await prisma.capability.create({
    data: {
      id: jti,
      runId: input.runId,
      workspaceId: input.workspaceId ?? null,
      actionClass: input.actionClass,
      scope: JSON.stringify(input.scope),
      policySnapshot: input.policySnapshot ? JSON.stringify(input.policySnapshot) : null,
      expiresAt,
      maxUses: input.maxUses ?? DEFAULT_MAX_USES,
    },
  });

  await persistEvent(prisma, {
    type: 'capability.issued',
    data: {
      capabilityId: jti,
      runId: input.runId,
      actionClass: input.actionClass,
      expiresAt: expiresAt.toISOString(),
      scopeHash,
      policySnapshotHash,
    },
  });

  return { ...capability, token };
}

// ── Validate ────────────────────────────────────────────────────────────

export async function validateCapability(
  prisma: PrismaClient,
  token: string,
  actionClass: string,
): Promise<ValidationResult> {
  // Step 1: Cryptographic verification (tries current key, then rotated keys)
  const claims = decodeToken(token);
  if (!claims) {
    return { valid: false, reason: 'Invalid or tampered capability token signature' };
  }

  // Step 2: Check token-embedded claims
  if (claims.aud !== TOKEN_AUD) {
    return { valid: false, reason: `Invalid audience: expected "${TOKEN_AUD}", got "${claims.aud}"` };
  }

  // Clock skew tolerance: allow ±60 seconds
  const nowSecs = Math.floor(Date.now() / 1000);
  if (nowSecs > claims.exp + CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: 'Capability token has expired (claims)' };
  }
  if (claims.iat > nowSecs + CLOCK_SKEW_SECONDS) {
    return { valid: false, reason: 'Capability token issued in the future (clock skew too large)' };
  }

  if (!actionClassMatches(claims.actionClass, actionClass)) {
    return {
      valid: false,
      reason: `Action class mismatch: token scoped to "${claims.actionClass}", requested "${actionClass}"`,
    };
  }

  // Step 3: DB checks (revocation, usage limits, run status)
  const capability = await prisma.capability.findUnique({ where: { id: claims.jti } });

  if (!capability) {
    return { valid: false, reason: 'Capability token not found in registry' };
  }

  if (capability.revokedAt) {
    return { valid: false, reason: 'Capability has been revoked' };
  }

  if (new Date() > capability.expiresAt) {
    await persistEvent(prisma, {
      type: 'capability.expired',
      data: { capabilityId: claims.jti },
    });
    return { valid: false, reason: 'Capability has expired' };
  }

  if (capability.usedCount >= capability.maxUses) {
    return { valid: false, reason: `Capability max uses exceeded (${capability.maxUses})` };
  }

  // Verify scope hash matches what's stored
  const storedScopeHash = hashJson(JSON.parse(capability.scope));
  if (storedScopeHash !== claims.scopeHash) {
    return { valid: false, reason: 'Scope hash mismatch — token may have been tampered' };
  }

  // Check that the run is still active and fetch orgId for cross-org check
  const run = await prisma.run.findUnique({
    where: { id: capability.runId },
    select: { status: true, orgId: true },
  });
  if (!run || !['running', 'scheduled'].includes(run.status)) {
    return { valid: false, reason: 'Associated run is no longer active' };
  }

  // Increment usage
  await prisma.capability.update({
    where: { id: claims.jti },
    data: { usedCount: { increment: 1 } },
  });

  return {
    valid: true,
    capability,
    scope: JSON.parse(capability.scope),
    claims,
    runOrgId: run.orgId,
  };
}

/**
 * Action class matching.
 * "github:pr:create" matches "github:pr:create" (exact)
 * "github:pr:*" matches "github:pr:create" (wildcard suffix)
 * "github:*" matches "github:pr:create" (parent wildcard)
 */
function actionClassMatches(pattern: string, requested: string): boolean {
  if (pattern === requested) return true;
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // "github:pr:"
    return requested.startsWith(prefix);
  }
  return false;
}

// ── Revoke ──────────────────────────────────────────────────────────────

export async function revokeCapability(
  prisma: PrismaClient,
  token: string,
  reason: string,
): Promise<PrismaCapability> {
  // If a full signed token is passed, extract jti
  const jti = extractJti(token);

  const capability = await prisma.capability.update({
    where: { id: jti },
    data: { revokedAt: new Date() },
  });

  await persistEvent(prisma, {
    type: 'capability.revoked',
    data: { capabilityId: jti, reason },
  });

  return capability;
}

/** Revoke all active capabilities for a run (used by kill switch). */
export async function revokeAllForRun(
  prisma: PrismaClient,
  runId: string,
  reason: string,
): Promise<number> {
  const result = await prisma.capability.updateMany({
    where: { runId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  return result.count;
}

// ── Query ───────────────────────────────────────────────────────────────

export async function getActiveCapabilities(
  prisma: PrismaClient,
  runId: string,
): Promise<PrismaCapability[]> {
  return prisma.capability.findMany({
    where: {
      runId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

// ── Utilities ───────────────────────────────────────────────────────────

/** Extract the jti from a full signed token or return as-is if it's already a jti. */
function extractJti(tokenOrJti: string): string {
  if (tokenOrJti.startsWith('wbl_cap_v1.')) {
    const parts = tokenOrJti.split('.');
    if (parts.length === 3) {
      try {
        const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'));
        return claims.jti;
      } catch {
        // fall through
      }
    }
  }
  return tokenOrJti;
}
