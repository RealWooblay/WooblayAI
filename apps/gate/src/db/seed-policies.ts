/**
 * Seed default policy rules on first startup.
 *
 * Only runs if the policy table is empty — does not overwrite existing policies.
 * Provides a sensible "balanced" default: read-only auto-allowed, writes require
 * approval, destructive auto-denied.
 */

import type { PrismaClient } from '@prisma/client';

export interface PolicyPreset {
  name: string;
  description: string;
  rules: Array<{
    priority: number;
    matchTool: string;
    riskTier: string;
    decision: string;
    enabled: boolean;
  }>;
}

/** Balanced: safe reads auto-allowed, writes need approval, destructive denied. */
export const PRESET_BALANCED: PolicyPreset = {
  name: 'Balanced',
  description: 'Safe reads auto-allowed. Writes need human approval. Destructive actions auto-denied.',
  rules: [
    // Safe read-only tools
    { priority: 10,  matchTool: 'read',            riskTier: '*',           decision: 'ALLOW', enabled: true },
    { priority: 20,  matchTool: 'web_search',      riskTier: '*',           decision: 'ALLOW', enabled: true },
    { priority: 30,  matchTool: 'web_fetch',       riskTier: 'READ',        decision: 'ALLOW', enabled: true },
    { priority: 40,  matchTool: 'sessions_list',   riskTier: '*',           decision: 'ALLOW', enabled: true },
    { priority: 50,  matchTool: 'sessions_history', riskTier: '*',          decision: 'ALLOW', enabled: true },
    { priority: 60,  matchTool: 'agents_list',     riskTier: '*',           decision: 'ALLOW', enabled: true },
    { priority: 70,  matchTool: 'memory_*',        riskTier: '*',           decision: 'ALLOW', enabled: true },
    { priority: 80,  matchTool: 'session_status',  riskTier: '*',           decision: 'ALLOW', enabled: true },
    // Exec: read-only shell commands auto-allowed
    { priority: 100, matchTool: 'exec',            riskTier: 'READ',        decision: 'ALLOW', enabled: true },
    // Exec: write-level needs approval
    { priority: 200, matchTool: 'exec',            riskTier: 'WRITE',       decision: 'APPROVE', enabled: true },
    // Exec: destructive auto-denied
    { priority: 300, matchTool: 'exec',            riskTier: 'DESTRUCTIVE', decision: 'DENY', enabled: true },
    // Catch-all: destructive denied, write needs approval
    { priority: 900, matchTool: '*',               riskTier: 'DESTRUCTIVE', decision: 'DENY', enabled: true },
    { priority: 950, matchTool: '*',               riskTier: 'WRITE',       decision: 'APPROVE', enabled: true },
  ],
};

/** Strict: everything except reads needs approval. */
export const PRESET_STRICT: PolicyPreset = {
  name: 'Strict',
  description: 'Everything except pure reads requires human approval. Maximum safety.',
  rules: [
    { priority: 10,  matchTool: 'read',  riskTier: '*',           decision: 'ALLOW', enabled: true },
    { priority: 100, matchTool: '*',      riskTier: 'READ',        decision: 'ALLOW', enabled: true },
    { priority: 200, matchTool: '*',      riskTier: 'DESTRUCTIVE', decision: 'DENY', enabled: true },
    { priority: 900, matchTool: '*',      riskTier: '*',           decision: 'APPROVE', enabled: true },
  ],
};

/** Permissive: most things auto-allowed, only destructive needs approval. */
export const PRESET_PERMISSIVE: PolicyPreset = {
  name: 'Permissive',
  description: 'Most actions auto-allowed. Only destructive operations need approval.',
  rules: [
    { priority: 10,  matchTool: '*', riskTier: 'READ',        decision: 'ALLOW', enabled: true },
    { priority: 20,  matchTool: '*', riskTier: 'WRITE',       decision: 'ALLOW', enabled: true },
    { priority: 100, matchTool: '*', riskTier: 'DESTRUCTIVE', decision: 'APPROVE', enabled: true },
  ],
};

export const ALL_PRESETS: Record<string, PolicyPreset> = {
  balanced: PRESET_BALANCED,
  strict: PRESET_STRICT,
  permissive: PRESET_PERMISSIVE,
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
