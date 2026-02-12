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

  // 2. Fetch all enabled policy rules, ordered by priority (lowest number = highest priority)
  const rules = await prisma.policyRule.findMany({
    where: { enabled: true },
    orderBy: { priority: 'asc' },
  });

  // 3. Find the first matching rule
  for (const rule of rules) {
    // Match tool name (glob)
    if (!globMatch(rule.matchTool, toolCall.toolName)) continue;

    // Match risk tier ("*" matches any tier)
    if (rule.riskTier !== '*' && rule.riskTier !== toolCall.riskTier) continue;

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
    return {
      decision: rule.decision as Decision,
      ruleId: rule.id,
      reason: `Matched rule #${rule.priority}: ${rule.matchTool}`,
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
