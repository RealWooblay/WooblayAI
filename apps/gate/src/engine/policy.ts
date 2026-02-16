/**
 * Policy evaluation engine.
 *
 * Evaluates a tool call against the ordered policy rule table and returns a
 * decision (ALLOW / DENY / APPROVE). First matching enabled rule wins.
 */

import type { PrismaClient, ToolCall as PrismaToolCall } from '@prisma/client';
import type { PolicyDecision } from '@wooblay/types';
import { Decision } from '@wooblay/types';

/**
 * Simple glob matching (supports "*" to match anything, and "prefix_*" style).
 * No external dependency required.
 */
function globMatch(pattern: string, value: string): boolean {
  // Exact match
  if (pattern === value) return true;
  // Wildcard: match everything
  if (pattern === '*') return true;
  // Trailing wildcard: "wooblay_*" matches "wooblay_exec"
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }
  return false;
}

/**
 * Evaluate the policy rules for a given tool call.
 *
 * @returns PolicyDecision indicating whether the call is allowed, denied, or
 *          requires human approval.
 */
export async function evaluatePolicy(
  prisma: PrismaClient,
  toolCall: PrismaToolCall,
  instanceId?: string | null,
): Promise<PolicyDecision> {
  // 1. Verify the agent exists and is allowlisted
  const agent = await prisma.agent.findUnique({
    where: { pubkey: toolCall.agentPubkey },
  });

  if (!agent) {
    return { decision: Decision.DENY, reason: 'Agent not found' };
  }
  if (agent.status !== 'active') {
    return { decision: Decision.DENY, reason: `Agent is ${agent.status}` };
  }
  if (!agent.allowlisted) {
    return { decision: Decision.DENY, reason: 'Agent is not allowlisted' };
  }

  // 2. Fetch enabled policy rules, ordered by priority (lowest number = highest priority).
  //    If instanceId is provided, check for instance-specific rules first.
  //    Instance-specific rules completely override globals (no merge).
  let rules = await prisma.policyRule.findMany({
    where: { enabled: true, instanceId: instanceId ?? null },
    orderBy: { priority: 'asc' },
  });

  // Fall back to global rules if instanceId was provided but no instance-specific rules exist
  if (instanceId && rules.length === 0) {
    rules = await prisma.policyRule.findMany({
      where: { enabled: true, instanceId: null },
      orderBy: { priority: 'asc' },
    });
  }

  // 3. Find the first matching rule
  for (const rule of rules) {
    // Match tool name (glob)
    if (!globMatch(rule.matchTool, toolCall.toolName)) continue;

    // Match risk tier ("*" matches any tier)
    if (rule.riskTier !== '*' && rule.riskTier !== toolCall.riskTier) continue;

    // Match business category (if specified on rule)
    if (rule.matchCategory && rule.matchCategory !== '*') {
      const toolCategory = (toolCall as any).category as string | null;
      // If the tool call has no category, category-specific rules should NOT match.
      // This prevents uncategorized calls from accidentally matching permissive category rules.
      if (!toolCategory) continue;
      if (rule.matchCategory !== toolCategory) continue;
    }

    // Match args pattern (optional JSON substring match)
    if (rule.matchArgs) {
      try {
        const pattern = JSON.parse(rule.matchArgs) as Record<string, unknown>;
        const args = JSON.parse(toolCall.args) as Record<string, unknown>;
        const matches = Object.entries(pattern).every(
          ([key, val]) => args[key] === val,
        );
        if (!matches) continue;
      } catch {
        // If the pattern can't be parsed, skip this rule
        continue;
      }
    }

    // First match wins
    const ruleLabel = rule.description ?? rule.matchTool;
    return {
      decision: rule.decision as Decision,
      ruleId: rule.id,
      reason: `Matched rule #${rule.priority}: ${ruleLabel}`,
      constraints: rule.constraints ? JSON.parse(rule.constraints) : undefined,
    };
  }

  // 4. Default policy when no rules match
  //    - WRITE / DESTRUCTIVE → APPROVE (require human sign-off)
  //    - READ → ALLOW
  if (toolCall.riskTier === 'WRITE' || toolCall.riskTier === 'DESTRUCTIVE') {
    return {
      decision: Decision.APPROVE,
      reason: 'Default: WRITE/DESTRUCTIVE requires approval',
    };
  }

  return {
    decision: Decision.ALLOW,
    reason: 'Default: READ allowed',
  };
}
