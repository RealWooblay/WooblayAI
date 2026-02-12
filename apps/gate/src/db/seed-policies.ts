/**
 * Policy presets — agentic-first.
 *
 * Philosophy: Agents should be able to WORK. The value of Wooblay is not
 * blanket blocking — it's AI-powered anomaly detection that flags what's
 * OUT OF THE NORM. Policies set broad guardrails. The AI supervisor catches
 * the weird stuff within allowed categories.
 *
 * Categories: code, git, packages, shell, files, network, secrets, infra,
 *             communication, destructive, data, other
 *
 * Only seeds if the policy table is empty — does not overwrite existing.
 */

import type { PrismaClient } from '@prisma/client';

export interface PolicyPreset {
  name: string;
  description: string;
  rules: Array<{
    priority: number;
    matchTool: string;
    riskTier: string;
    matchCategory?: string;
    decision: string;
    description?: string;
    enabled: boolean;
  }>;
}

/**
 * Balanced: The agent can code, commit, push, run commands, install packages
 * freely. Destructive ops need a human glance. Secrets and infra are hard-blocked.
 * AI anomaly detection handles the "that's weird" stuff within allowed categories.
 */
export const PRESET_BALANCED: PolicyPreset = {
  name: 'Balanced',
  description: 'Agent works autonomously. Destructive ops need review. Secrets and infra blocked. AI flags anomalies.',
  rules: [
    // ── Safety nets (highest priority) ────────────────────────────────────
    // Hard-block dangerous categories regardless of risk tier
    { priority: 5,   matchTool: '*', riskTier: '*', matchCategory: 'secrets',     decision: 'DENY', description: 'Secrets & credentials — blocked', enabled: true },
    { priority: 6,   matchTool: '*', riskTier: '*', matchCategory: 'infra',       decision: 'DENY', description: 'Infrastructure changes — blocked', enabled: true },

    // Destructive actions always need a human look (even in allowed categories)
    { priority: 10,  matchTool: '*', riskTier: 'DESTRUCTIVE', decision: 'APPROVE', description: 'Destructive operations — needs review', enabled: true },

    // ── Reads are always safe ─────────────────────────────────────────────
    { priority: 20,  matchTool: '*', riskTier: 'READ', decision: 'ALLOW', description: 'Read-only actions — safe', enabled: true },

    // ── Work categories — the agent needs to function ─────────────────────
    { priority: 100, matchTool: '*', riskTier: '*', matchCategory: 'code',     decision: 'ALLOW', description: 'Code changes — auto-allowed', enabled: true },
    { priority: 110, matchTool: '*', riskTier: '*', matchCategory: 'git',      decision: 'ALLOW', description: 'Git operations — auto-allowed', enabled: true },
    { priority: 120, matchTool: '*', riskTier: '*', matchCategory: 'files',    decision: 'ALLOW', description: 'File operations — auto-allowed', enabled: true },
    { priority: 130, matchTool: '*', riskTier: '*', matchCategory: 'shell',    decision: 'ALLOW', description: 'Shell commands — auto-allowed', enabled: true },
    { priority: 140, matchTool: '*', riskTier: '*', matchCategory: 'packages', decision: 'ALLOW', description: 'Package installs — auto-allowed', enabled: true },

    // ── External-facing — worth a glance ──────────────────────────────────
    { priority: 200, matchTool: '*', riskTier: '*', matchCategory: 'network',       decision: 'APPROVE', description: 'Network requests — needs review', enabled: true },
    { priority: 210, matchTool: '*', riskTier: '*', matchCategory: 'data',          decision: 'APPROVE', description: 'Data access — needs review', enabled: true },
    { priority: 220, matchTool: '*', riskTier: '*', matchCategory: 'communication', decision: 'APPROVE', description: 'Communication — needs review', enabled: true },

    // ── Catch-all for uncategorized ───────────────────────────────────────
    { priority: 900, matchTool: '*', riskTier: 'WRITE', decision: 'APPROVE', description: 'Other writes — needs review', enabled: true },
  ],
};

/**
 * Strict: Agent can code and read freely. Everything else needs approval.
 * Secrets, infra, destructive outright blocked.
 */
export const PRESET_STRICT: PolicyPreset = {
  name: 'Strict',
  description: 'Maximum safety. Only reads and code auto-allowed. Everything else needs approval or is blocked.',
  rules: [
    // Hard blocks
    { priority: 5,   matchTool: '*', riskTier: '*', matchCategory: 'secrets', decision: 'DENY', description: 'Secrets — blocked', enabled: true },
    { priority: 6,   matchTool: '*', riskTier: '*', matchCategory: 'infra',   decision: 'DENY', description: 'Infrastructure — blocked', enabled: true },
    { priority: 10,  matchTool: '*', riskTier: 'DESTRUCTIVE',                 decision: 'DENY', description: 'Destructive — blocked', enabled: true },

    // Safe actions
    { priority: 20,  matchTool: '*', riskTier: 'READ',                        decision: 'ALLOW', description: 'Read-only — safe', enabled: true },
    { priority: 100, matchTool: '*', riskTier: '*', matchCategory: 'code',    decision: 'ALLOW', description: 'Code changes — auto-allowed', enabled: true },

    // Everything else: human approval
    { priority: 900, matchTool: '*', riskTier: '*', decision: 'APPROVE', description: 'All other actions — needs review', enabled: true },
  ],
};

/**
 * Permissive: Full trust. Agent does whatever it wants.
 * Only secrets are hard-blocked. Destructive gets a quick review.
 */
export const PRESET_PERMISSIVE: PolicyPreset = {
  name: 'Permissive',
  description: 'Full trust mode. Agent works freely. Only secrets blocked, destructive reviewed.',
  rules: [
    // Only hard-block secrets
    { priority: 5,   matchTool: '*', riskTier: '*', matchCategory: 'secrets', decision: 'DENY', description: 'Secrets — blocked', enabled: true },

    // Destructive gets a quick human check
    { priority: 10,  matchTool: '*', riskTier: 'DESTRUCTIVE', decision: 'APPROVE', description: 'Destructive — quick review', enabled: true },

    // Everything else: go for it
    { priority: 20,  matchTool: '*', riskTier: 'READ',  decision: 'ALLOW', description: 'Read-only — safe', enabled: true },
    { priority: 30,  matchTool: '*', riskTier: 'WRITE', decision: 'ALLOW', description: 'Writes — auto-allowed', enabled: true },
  ],
};

/**
 * Monitor Only: Everything auto-allowed. AI detection still flags anomalies.
 * Zero blocking — purely observational. Great for trusted agents where you
 * just want the AI supervisor to watch and flag, not gate.
 */
export const PRESET_MONITOR: PolicyPreset = {
  name: 'Monitor Only',
  description: 'Everything auto-allowed. AI detection still flags anomalies. Zero blocking.',
  rules: [
    { priority: 10, matchTool: '*', riskTier: '*', decision: 'ALLOW', description: 'All actions auto-allowed — AI monitors for anomalies', enabled: true },
  ],
};

export const ALL_PRESETS: Record<string, PolicyPreset> = {
  balanced: PRESET_BALANCED,
  strict: PRESET_STRICT,
  permissive: PRESET_PERMISSIVE,
  monitor: PRESET_MONITOR,
};

/**
 * Seed the default (balanced) policies if the policy table is empty.
 * Returns the number of policies created (0 if table already had data).
 */
export async function seedDefaultPolicies(prisma: PrismaClient): Promise<number> {
  const count = await prisma.policyRule.count();
  if (count > 0) return 0;

  const created = await prisma.$transaction(
    PRESET_BALANCED.rules.map((rule) =>
      prisma.policyRule.create({ data: rule }),
    ),
  );

  return created.length;
}
