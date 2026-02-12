/**
 * Risk classifier.
 *
 * Inspects the tool name and arguments to assign a RiskTier and business-context
 * category. This keeps risk assessment deterministic and auditable.
 */

import { RiskTier } from '@wooblay/types';

// ── Business-context categories ─────────────────────────────────────────────

export type BusinessCategory =
  | 'code'           // creating/editing source files
  | 'git'            // commits, pushes, PRs, branch ops
  | 'packages'       // npm install, pip install, deps
  | 'shell'          // general command execution
  | 'files'          // file system ops (mkdir, cp, mv, read non-code)
  | 'network'        // HTTP requests, API calls, web fetching
  | 'secrets'        // accessing .env, credentials, API keys
  | 'infra'          // deployment, server config, Docker, CI/CD
  | 'communication'  // sending messages, emails, webhooks
  | 'destructive'    // rm -rf, drop, format, irreversible
  | 'data'           // database queries, data manipulation
  | 'other';         // unknown/unclassified

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|css|scss|html|vue|svelte|json|yaml|yml|toml|md|sql)$/i;
const SECRET_PATTERNS = [/\.env/, /credential/i, /secret/i, /password/i, /\.pem$/, /\.key$/, /id_rsa/, /api[_-]?key/i, /token/i, /\.aws\//];
const INFRA_PATTERNS = [/docker/i, /deploy/i, /ci[/-]cd/i, /nginx/i, /systemd/i, /terraform/i, /ansible/i, /k8s/i, /kubernetes/i];

/**
 * Classify a tool call into a business-context category.
 * Heuristic-first (fast, regex-based). AI enrichment runs async.
 */
export function classifyCategory(
  toolName: string,
  args: Record<string, unknown>,
): BusinessCategory {
  const normalized = toolName.replace(/^(wooblay_|gated_)/, '');
  const command = String(args['command'] ?? args['cmd'] ?? '');
  const path = String(args['path'] ?? args['file'] ?? args['filepath'] ?? '');
  const url = String(args['url'] ?? '');
  const allArgs = JSON.stringify(args).toLowerCase();

  // Check for secrets access first (highest priority)
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(path) || pattern.test(command) || pattern.test(allArgs)) {
      return 'secrets';
    }
  }

  // Destructive operations
  if (normalized === 'exec' || normalized === 'process') {
    for (const p of DESTRUCTIVE_PATTERNS) {
      if (p.test(command)) return 'destructive';
    }
  }

  // Git operations
  if (/\bgit\s+(push|commit|merge|rebase|pull|clone|checkout|branch|tag|stash|reset|cherry-pick)\b/.test(command)) {
    return 'git';
  }

  // Package management
  if (/\b(npm|yarn|pnpm|pip|cargo|gem|composer|brew)\s+(install|add|remove|uninstall|update|upgrade|publish)\b/.test(command)) {
    return 'packages';
  }

  // Infrastructure
  for (const p of INFRA_PATTERNS) {
    if (p.test(command) || p.test(path)) return 'infra';
  }

  // Network operations
  if (['http', 'web_fetch', 'web_search'].includes(normalized)) {
    return 'network';
  }
  if (url && (url.startsWith('http') || url.startsWith('//'))) {
    return 'network';
  }

  // Communication / agent coordination
  if (['sessions_spawn', 'sessions_send', 'message'].includes(normalized)) {
    return 'communication';
  }

  // File operations — distinguish code from generic files
  if (['write', 'edit', 'apply_patch'].includes(normalized)) {
    if (CODE_EXTENSIONS.test(path)) return 'code';
    return 'files';
  }
  if (normalized === 'read') {
    if (CODE_EXTENSIONS.test(path)) return 'code';
    return 'files';
  }

  // Shell commands (general exec that didn't match above)
  if (normalized === 'exec' || normalized === 'process') {
    return 'shell';
  }

  // Browser
  if (normalized === 'browser') return 'network';

  return 'other';
}

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
