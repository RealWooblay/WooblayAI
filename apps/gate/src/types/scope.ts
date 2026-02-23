/** Scope Boundary types — per-connection fine-grained permission controls. */

export interface ScopeBoundary {
  /** Patterns that ARE allowed */
  allowed: string[];
  /** Patterns that are NOT allowed (take precedence over allowed) */
  blocked: string[];
}

export interface ScopeBoundaries {
  [action: string]: ScopeBoundary;
}

export interface ScopeCheckResult {
  allowed: boolean;
  reason?: string;
}
