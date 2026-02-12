import { RiskTier } from '@wooblay/types';

// ── Pattern sets for exec command classification ──────────────────────

const DESTRUCTIVE_COMMANDS = [
  'rm -rf',
  'rm -fr',
  'sudo',
  'mkfs',
  'dd ',
  'chmod 777',
  'format ',
];

const DESTRUCTIVE_SQL = ['DROP ', 'DELETE ', 'TRUNCATE '];

const WRITE_COMMANDS = [
  'mv ',
  'cp ',
  'mkdir ',
  'touch ',
  'tee ',
  'git push',
  'git commit',
  'npm install',
  'npm publish',
  'pip install',
  'yarn add',
  'pnpm add',
  'brew install',
  'apt install',
  'apt-get install',
];

const WRITE_OPERATORS = ['>', '>>'];

const NETWORK_COMMANDS = ['curl ', 'wget ', 'scp ', 'rsync '];

const SENSITIVE_PATHS = ['/', '/etc', '/usr', '/var', '/boot', '/sys', '/proc', '~/.ssh'];

// ── Classifier ────────────────────────────────────────────────────────

/**
 * Classify the risk tier of a tool invocation.
 *
 * Risk tiers (from @wooblay/types):
 * - READ:        no side effects
 * - WRITE:       creates or modifies data
 * - DESTRUCTIVE: irreversible or dangerous operations
 */
export function classifyRisk(
  toolName: string,
  args: Record<string, unknown>,
): RiskTier {
  switch (toolName) {
    case 'wooblay_exec':
      return classifyExec(String(args.command ?? ''));

    case 'wooblay_browser':
      return RiskTier.WRITE;

    case 'wooblay_http':
      return classifyHttp(String(args.method ?? 'GET').toUpperCase());

    default:
      // Unknown tools default to WRITE out of caution
      return RiskTier.WRITE;
  }
}

// ── Exec sub-classifier ──────────────────────────────────────────────

function classifyExec(command: string): RiskTier {
  const cmd = command.toLowerCase();

  // Check destructive patterns first (highest risk)
  for (const pattern of DESTRUCTIVE_COMMANDS) {
    if (cmd.includes(pattern.toLowerCase())) return RiskTier.DESTRUCTIVE;
  }

  for (const pattern of DESTRUCTIVE_SQL) {
    if (cmd.includes(pattern.toLowerCase())) return RiskTier.DESTRUCTIVE;
  }

  // Sensitive path detection elevates to DESTRUCTIVE
  for (const sp of SENSITIVE_PATHS) {
    const normalized = sp.toLowerCase();
    // Match path boundaries: the sensitive path followed by end-of-string,
    // a space, or a path separator ensures we don't match partial paths
    // like "/etcetera"
    const pathRegex = new RegExp(
      `(?:^|\\s)${escapeRegex(normalized)}(?:\\s|/|$)`,
    );
    if (pathRegex.test(cmd)) return RiskTier.DESTRUCTIVE;
  }

  // Write operations
  for (const pattern of WRITE_COMMANDS) {
    if (cmd.includes(pattern.toLowerCase())) return RiskTier.WRITE;
  }

  for (const op of WRITE_OPERATORS) {
    if (cmd.includes(op)) return RiskTier.WRITE;
  }

  // Network commands are WRITE tier
  for (const pattern of NETWORK_COMMANDS) {
    if (cmd.includes(pattern.toLowerCase())) return RiskTier.WRITE;
  }

  // Default: READ
  return RiskTier.READ;
}

// ── HTTP sub-classifier ──────────────────────────────────────────────

function classifyHttp(method: string): RiskTier {
  switch (method) {
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
      return RiskTier.READ;
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
      return RiskTier.WRITE;
    default:
      return RiskTier.WRITE;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
