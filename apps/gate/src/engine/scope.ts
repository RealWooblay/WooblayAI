/**
 * Scope Boundaries — per-connection fine-grained permission controls.
 *
 * Each connection can have scope boundaries that restrict what actions
 * agents can perform through that connection. Boundaries are stored as JSON
 * on the Connection model.
 *
 * Format:
 * {
 *   "git:push": {
 *     "allowed": ["feature-*", "fix/*"],
 *     "blocked": ["main", "master", "dev", "staging", "production"]
 *   },
 *   "github:pr:merge": {
 *     "allowed": ["*"],
 *     "blocked": []
 *   },
 *   "aws:s3:cp": {
 *     "allowed": ["s3://staging-*"],
 *     "blocked": ["s3://prod-*", "s3://backup-*"]
 *   }
 * }
 *
 * Matching:
 * - "*" matches anything
 * - "prefix-*" matches anything starting with "prefix-"
 * - "exact" matches only "exact"
 * - Blocked rules take precedence over allowed rules
 *
 * If an action has no scope boundary entry, it is allowed by default
 * (policy gate handles top-level allow/deny).
 */

import type { ScopeBoundary, ScopeBoundaries, ScopeCheckResult } from '../types/scope.js';
export type { ScopeBoundary, ScopeBoundaries, ScopeCheckResult };

// ── Scope Target Extraction ─────────────────────────────────────────────

/**
 * Extract the scope-relevant target from action params.
 * Different actions have different "targets" that scope applies to.
 */
function extractScopeTarget(action: string, params: Record<string, unknown>): string | null {
  switch (action) {
    case 'git:push':
    case 'git:pull':
      return String(params.branch ?? '');
    case 'git:clone':
      return String(params.url ?? '');
    case 'github:pr:create':
    case 'github:pr:comment':
    case 'github:pr:merge':
      return String(params.repo ?? `${params.owner}/${params.repo_name}`);
    case 'aws:s3:cp':
      return String(params.destination ?? params.source ?? '');
    case 'aws:ecs:deploy':
      return String(params.service ?? '');
    case 'gcp:cloudrun:deploy':
      return String(params.service ?? '');
    case 'gcp:gcs:cp':
      return String(params.destination ?? params.source ?? '');
    default:
      return null;
  }
}

// ── Pattern Matching ────────────────────────────────────────────────────

import { globMatch } from '../utils/glob-match.js';

/**
 * Test if a target matches any pattern in a list.
 */
function matchesAnyPattern(target: string, patterns: string[]): boolean {
  return patterns.some((p) => globMatch(p, target));
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Parse scope boundaries from the connection's JSON string.
 */
export function parseScopeBoundaries(raw: string | null | undefined): ScopeBoundaries {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ScopeBoundaries;
  } catch {
    return {};
  }
}

/**
 * Check if a structured action is within scope boundaries.
 *
 * Logic:
 *   1. If no boundary defined for this action → allowed
 *   2. If target matches any blocked pattern → denied
 *   3. If target matches any allowed pattern → allowed
 *   4. If allowed list exists but target doesn't match → denied
 *   5. If no allowed list → allowed
 */
export function checkScope(
  boundaries: ScopeBoundaries,
  action: string,
  params: Record<string, unknown>,
): ScopeCheckResult {
  const boundary = boundaries[action];
  if (!boundary) {
    return { allowed: true };
  }

  const target = extractScopeTarget(action, params);
  if (!target) {
    // Can't extract a meaningful target — allow (policy gate handles broader rules)
    return { allowed: true };
  }

  // Blocked takes precedence
  if (boundary.blocked.length > 0 && matchesAnyPattern(target, boundary.blocked)) {
    return {
      allowed: false,
      reason: `Target "${target}" is blocked by scope boundary for ${action}`,
    };
  }

  // If allowed list exists, target must match
  if (boundary.allowed.length > 0) {
    if (matchesAnyPattern(target, boundary.allowed)) {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: `Target "${target}" is not in the allowed list for ${action}. Allowed: ${boundary.allowed.join(', ')}`,
    };
  }

  // No allowed list, not blocked → allowed
  return { allowed: true };
}

/**
 * Describe what a connection's scope boundaries allow/block
 * (for display in the UI).
 */
export function describeScopeBoundaries(boundaries: ScopeBoundaries): Array<{
  action: string;
  allowed: string[];
  blocked: string[];
}> {
  return Object.entries(boundaries).map(([action, boundary]) => ({
    action,
    allowed: boundary.allowed,
    blocked: boundary.blocked,
  }));
}
