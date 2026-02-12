/**
 * Risk classifier.
 *
 * Inspects the tool name and arguments to assign a RiskTier. This keeps
 * risk assessment deterministic and auditable.
 */

import { RiskTier } from '@wooblay/types';

/** Patterns that indicate a destructive shell command. */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-\w*)?-r/,  // rm -rf, rm -r
  /\brm\s+(-\w*)?-f/,  // rm -f
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\b\s+/,
  /\bformat\b/,
  /\bfdisk\b/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bchmod\s+777\b/,
  />\s*\/dev\//,
];

/** Patterns that indicate a write-level shell command. */
const WRITE_PATTERNS = [
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\btouch\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\btee\b/,
  /\bsed\b.*-i/,
  /\bawk\b.*-i\s+inplace/,
  /\bgit\s+(push|commit|merge|rebase)\b/,
  /\bnpm\s+(publish|install)\b/,
  /\bpip\s+install\b/,
  />>?\s/,  // stdout/stderr redirection
];

/**
 * Classify the risk tier of a tool call based on the tool name and arguments.
 */
export function classifyRisk(
  toolName: string,
  args: Record<string, unknown>,
): RiskTier {
  // Normalize tool name: support both Wooblay-prefixed (wooblay_exec)
  // and native agent tool names (exec, process, browser, etc.)
  const normalized = toolName.replace(/^wooblay_/, '');

  switch (normalized) {
    case 'exec':
    case 'process': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      // Check destructive first (superset of write)
      for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(command)) return RiskTier.DESTRUCTIVE;
      }
      for (const pattern of WRITE_PATTERNS) {
        if (pattern.test(command)) return RiskTier.WRITE;
      }
      return RiskTier.READ;
    }

    case 'http':
    case 'web_fetch':
    case 'web_search': {
      const method = String(args['method'] ?? 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return RiskTier.READ;
      }
      if (method === 'DELETE') {
        return RiskTier.DESTRUCTIVE;
      }
      // POST, PUT, PATCH
      return RiskTier.WRITE;
    }

    case 'browser':
      // Browser automation can mutate external state
      return RiskTier.WRITE;

    // File operations — classify by nature
    case 'read':
      return RiskTier.READ;

    case 'write':
    case 'edit':
    case 'apply_patch':
      return RiskTier.WRITE;

    // Agent coordination — classify as WRITE (spawns sub-agents / sends messages)
    case 'sessions_spawn':
    case 'sessions_send':
    case 'message':
      return RiskTier.WRITE;

    // System tools
    case 'cron':
    case 'gateway':
      return RiskTier.WRITE;

    default:
      // Unknown tools default to WRITE for safety
      return RiskTier.WRITE;
  }
}
