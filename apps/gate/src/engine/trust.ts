/**
 * Agent Trust Score computation.
 *
 * Computes a 0-100 score per agent pubkey based on:
 *   +1 per approved action (max +20)
 *   -3 per denied action
 *   -10 per CRITICAL flag
 *   -5 per HIGH flag
 *   +0.5 per auto-allowed action
 *   Base: 70 (neutral)
 *   Clamped 0-100
 */

import type { PrismaClient } from '@prisma/client';

export interface TrustBreakdown {
  score: number;
  base: number;
  approvedBonus: number;
  autoAllowedBonus: number;
  deniedPenalty: number;
  criticalFlagPenalty: number;
  highFlagPenalty: number;
  totalActions: number;
}

export interface TrustResult {
  score: number;
  breakdown: TrustBreakdown;
  trend: 'up' | 'down' | 'stable';
}

export async function computeTrustScore(
  prisma: PrismaClient,
  agentPubkey: string,
): Promise<TrustResult> {
  const BASE = 70;

  // Count auto-allowed (receipt with ALLOW decision)
  const autoAllowed = await prisma.receipt.count({
    where: { agentPubkey, policyDecision: 'ALLOW' },
  });

  // Count human-approved
  const humanApproved = await prisma.receipt.count({
    where: { agentPubkey, approvalDecision: 'APPROVED' },
  });

  // Count denied
  const denied = await prisma.receipt.count({
    where: {
      agentPubkey,
      OR: [
        { policyDecision: 'DENY' },
        { approvalDecision: 'DENIED' },
      ],
    },
  });

  // Count CRITICAL flags
  const criticalFlags = await prisma.auditFlag.count({
    where: { agentPubkey, severity: 'CRITICAL', dismissed: false },
  });

  // Count HIGH flags
  const highFlags = await prisma.auditFlag.count({
    where: { agentPubkey, severity: 'HIGH', dismissed: false },
  });

  const approvedBonus = Math.min(humanApproved * 1, 20);
  const autoAllowedBonus = Math.min(autoAllowed * 0.5, 15);
  const deniedPenalty = denied * 3;
  const criticalFlagPenalty = criticalFlags * 10;
  const highFlagPenalty = highFlags * 5;

  const raw = BASE + approvedBonus + autoAllowedBonus - deniedPenalty - criticalFlagPenalty - highFlagPenalty;
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // Compute trend: compare last 24h vs previous 24h
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const [recentDenied, olderDenied] = await Promise.all([
    prisma.receipt.count({
      where: {
        agentPubkey,
        createdAt: { gte: oneDayAgo },
        OR: [{ policyDecision: 'DENY' }, { approvalDecision: 'DENIED' }],
      },
    }),
    prisma.receipt.count({
      where: {
        agentPubkey,
        createdAt: { gte: twoDaysAgo, lt: oneDayAgo },
        OR: [{ policyDecision: 'DENY' }, { approvalDecision: 'DENIED' }],
      },
    }),
  ]);

  let trend: 'up' | 'down' | 'stable' = 'stable';
  if (recentDenied < olderDenied) trend = 'up';
  if (recentDenied > olderDenied) trend = 'down';

  return {
    score,
    breakdown: {
      score,
      base: BASE,
      approvedBonus,
      autoAllowedBonus,
      deniedPenalty,
      criticalFlagPenalty,
      highFlagPenalty,
      totalActions: autoAllowed + humanApproved + denied,
    },
    trend,
  };
}
