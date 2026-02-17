/** Capability token types. */

export interface KeyEntry {
  kid: string;
  /** hex-encoded public key */
  pub: string;
}

export interface CapabilityClaims {
  /** Token version */
  v: number;
  /** Audience — must be 'wooblay:gateway' */
  aud: string;
  /** Key ID — identifies which signing key was used */
  kid: string;
  /** Issued at (unix seconds) */
  iat: number;
  /** Expires at (unix seconds) */
  exp: number;
  /** Unique token ID (stored as capability.id in DB) */
  jti: string;
  /** Run this capability belongs to */
  runId: string;
  /** Workspace this capability is scoped to (optional) */
  workspaceId: string | null;
  /** Action class pattern this token authorizes */
  actionClass: string;
  /** SHA-256 of canonicalized scope JSON */
  scopeHash: string;
  /** SHA-256 of policy snapshot that authorized this (if present) */
  policySnapshotHash: string | null;
}

export interface MintCapabilityInput {
  runId: string;
  workspaceId?: string;
  actionClass: string;
  scope: Record<string, unknown>;
  policySnapshot?: Record<string, unknown>;
  ttlMs?: number;
  maxUses?: number;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
  capability?: unknown;
  scope?: Record<string, unknown>;
  claims?: CapabilityClaims;
  /** The orgId of the run this capability belongs to */
  runOrgId?: string | null;
}
