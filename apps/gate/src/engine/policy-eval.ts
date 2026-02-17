/**
 * Enhanced Policy Evaluation — proposal-aware policy engine.
 *
 * Extends the existing policy.ts with:
 * - Evidence requirements based on risk class
 * - Budget checks before approval
 * - Required approvers by risk level
 * - PolicySnapshot capture for audit trail
 * - Irreversible action enforcement
 */

import type { PrismaClient, PolicyRule as PrismaPolicyRule } from '@prisma/client';
import { Decision } from '@wooblay/types';
import type { RiskClass } from '@wooblay/types';
import { checkBudget } from './budget.js';

import type { ProposalPolicyInput, ProposalPolicyDecision } from '../types/policy.js';
export type { ProposalPolicyInput, ProposalPolicyDecision };

// ── Evidence Requirements ───────────────────────────────────────────────

const EVIDENCE_REQUIRED_RISK: Set<string> = new Set(['high', 'critical']);

// ── Approver Requirements ───────────────────────────────────────────────

const APPROVER_ROLE_BY_RISK: Record<string, string> = {
  low: 'member',
  medium: 'member',
  high: 'admin',
  critical: 'owner',
};

// ── Policy Evaluation ───────────────────────────────────────────────────

export async function evaluateProposalPolicy(
  prisma: PrismaClient,
  input: ProposalPolicyInput,
): Promise<ProposalPolicyDecision> {
  // 1. Budget check
  const budget = await checkBudget(prisma, input.runId, input.estimatedCostCents ?? 0);
  if (!budget.allowed) {
    return {
      decision: 'deny',
      reason: budget.reason ?? 'Budget exceeded',
      policySnapshot: '{}',
      requiresEvidence: false,
      budgetCheck: budget,
    };
  }

  // 2. Check if evidence is required but missing
  const requiresEvidence = EVIDENCE_REQUIRED_RISK.has(input.riskClass);
  if (requiresEvidence && !input.hasEvidence) {
    return {
      decision: 'require_approval',
      reason: `${input.riskClass} risk actions require evidence. Attach an evidence bundle before approval.`,
      policySnapshot: '{}',
      requiresEvidence: true,
      budgetCheck: budget,
      requiredApproverRole: APPROVER_ROLE_BY_RISK[input.riskClass] ?? 'admin',
    };
  }

  // 3. Irreversible actions always require human approval (admin+)
  if (input.irreversible) {
    return {
      decision: 'require_approval',
      reason: 'Irreversible action: requires human approval with compensating action plan.',
      policySnapshot: '{}',
      requiresEvidence: true,
      budgetCheck: budget,
      requiredApproverRole: 'admin',
    };
  }

  // 4. Fetch matching policy rules
  let rules = await prisma.policyRule.findMany({
    where: { enabled: true, instanceId: input.instanceId ?? null },
    orderBy: { priority: 'asc' },
  });

  if (input.instanceId && rules.length === 0) {
    rules = await prisma.policyRule.findMany({
      where: { enabled: true, instanceId: null },
      orderBy: { priority: 'asc' },
    });
  }

  // 5. Find first matching rule
  for (const rule of rules) {
    if (!actionClassGlob(rule.matchTool, input.toolName)) continue;
    if (rule.riskTier !== '*' && rule.riskTier.toLowerCase() !== input.riskClass) continue;

    const snapshot = JSON.stringify({
      id: rule.id,
      priority: rule.priority,
      matchTool: rule.matchTool,
      riskTier: rule.riskTier,
      decision: rule.decision,
      description: rule.description,
      capturedAt: new Date().toISOString(),
    });

    if (rule.decision === Decision.ALLOW) {
      return {
        decision: input.riskClass === 'low' ? 'auto_approve' : 'require_approval',
        reason: `Matched rule #${rule.priority}: ${rule.description ?? rule.matchTool}`,
        ruleId: rule.id,
        policySnapshot: snapshot,
        requiresEvidence,
        budgetCheck: budget,
        requiredApproverRole: APPROVER_ROLE_BY_RISK[input.riskClass],
      };
    }

    if (rule.decision === Decision.DENY) {
      return {
        decision: 'deny',
        reason: `Denied by rule #${rule.priority}: ${rule.description ?? rule.matchTool}`,
        ruleId: rule.id,
        policySnapshot: snapshot,
        requiresEvidence: false,
        budgetCheck: budget,
      };
    }

    if (rule.decision === Decision.APPROVE) {
      return {
        decision: 'require_approval',
        reason: `Requires approval per rule #${rule.priority}: ${rule.description ?? rule.matchTool}`,
        ruleId: rule.id,
        policySnapshot: snapshot,
        requiresEvidence,
        budgetCheck: budget,
        requiredApproverRole: APPROVER_ROLE_BY_RISK[input.riskClass],
      };
    }
  }

  // 6. Default: risk-based decision
  const defaultSnapshot = JSON.stringify({
    id: null,
    matchTool: '*',
    riskTier: input.riskClass,
    decision: input.riskClass === 'low' ? 'auto_approve' : 'require_approval',
    description: 'Default risk-based policy',
    capturedAt: new Date().toISOString(),
  });

  if (input.riskClass === 'low') {
    return {
      decision: 'auto_approve',
      reason: 'Default: low risk auto-approved',
      policySnapshot: defaultSnapshot,
      requiresEvidence: false,
      budgetCheck: budget,
    };
  }

  return {
    decision: 'require_approval',
    reason: `Default: ${input.riskClass} risk requires approval`,
    policySnapshot: defaultSnapshot,
    requiresEvidence,
    budgetCheck: budget,
    requiredApproverRole: APPROVER_ROLE_BY_RISK[input.riskClass],
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

function actionClassGlob(pattern: string, value: string): boolean {
  if (pattern === value || pattern === '*') return true;
  if (pattern.endsWith('*')) return value.startsWith(pattern.slice(0, -1));
  return false;
}

/**
 * Validate that an approver has the required role.
 */
export async function validateApproverRole(
  prisma: PrismaClient,
  userId: string,
  requiredRole: string,
): Promise<{ valid: boolean; actualRole: string; reason?: string }> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { valid: false, actualRole: 'none', reason: 'User not found' };

  const roleHierarchy: Record<string, number> = {
    viewer: 0,
    member: 1,
    admin: 2,
    owner: 3,
  };

  const required = roleHierarchy[requiredRole] ?? 1;
  const actual = roleHierarchy[user.role] ?? 0;

  if (actual < required) {
    return {
      valid: false,
      actualRole: user.role,
      reason: `Requires ${requiredRole} role, but user has ${user.role}`,
    };
  }

  return { valid: true, actualRole: user.role };
}
