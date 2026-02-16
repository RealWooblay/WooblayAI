/**
 * Insights routes — metric display (no automation).
 *
 * Computes and displays per-action-class metrics:
 * - Success rate, override rate, rollback rate, sample count, MTTF.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

export async function insightsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/insights/metrics
   *
   * Per-action-class metrics for the autonomy ladder display.
   */
  app.get('/api/insights/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { days?: string };
    const days = Math.min(Number(query.days) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Get all proposals in the time window, grouped by actionClass
    const proposals = await prisma.proposal.findMany({
      where: { createdAt: { gte: since } },
      select: {
        actionClass: true,
        status: true,
        riskClass: true,
        irreversible: true,
        createdAt: true,
        approvedAt: true,
      },
    });

    // Group by action class
    const byClass = new Map<string, typeof proposals>();
    for (const p of proposals) {
      const list = byClass.get(p.actionClass) ?? [];
      list.push(p);
      byClass.set(p.actionClass, list);
    }

    const metrics = Array.from(byClass.entries()).map(([actionClass, items]) => {
      const total = items.length;
      const executed = items.filter((p) => p.status === 'executed' || p.status === 'verified').length;
      const verified = items.filter((p) => p.status === 'verified').length;
      const denied = items.filter((p) => p.status === 'denied').length;
      const rolledBack = items.filter((p) => p.status === 'rolled_back').length;

      // Success = verified / (executed + verified + rolled_back)
      const completedCount = executed + verified + rolledBack;
      const successRate = completedCount > 0 ? (verified / completedCount) * 100 : 0;

      // Override rate = denied / total
      const overrideRate = total > 0 ? (denied / total) * 100 : 0;

      // Rollback rate = rolled_back / completedCount
      const rollbackRate = completedCount > 0 ? (rolledBack / completedCount) * 100 : 0;

      // Mean time to fix (from proposal creation to verified)
      const verifiedItems = items.filter((p) => p.status === 'verified' && p.approvedAt);
      const mttfMs = verifiedItems.length > 0
        ? verifiedItems.reduce((sum, p) => {
            return sum + (new Date(p.approvedAt!).getTime() - new Date(p.createdAt).getTime());
          }, 0) / verifiedItems.length
        : null;

      // Risk distribution
      const riskDistribution = {
        low: items.filter((p) => p.riskClass === 'low').length,
        medium: items.filter((p) => p.riskClass === 'medium').length,
        high: items.filter((p) => p.riskClass === 'high').length,
        critical: items.filter((p) => p.riskClass === 'critical').length,
      };

      return {
        actionClass,
        total,
        executed,
        verified,
        denied,
        rolledBack,
        successRate: Math.round(successRate * 10) / 10,
        overrideRate: Math.round(overrideRate * 10) / 10,
        rollbackRate: Math.round(rollbackRate * 10) / 10,
        mttfMs: mttfMs ? Math.round(mttfMs) : null,
        riskDistribution,
        hasIrreversible: items.some((p) => p.irreversible),
      };
    });

    // Sort by total (most active first)
    metrics.sort((a, b) => b.total - a.total);

    return reply.send({ metrics, periodDays: days, since: since.toISOString() });
  });

  /**
   * GET /api/insights/summary
   *
   * High-level summary: total incidents, runs, success rate, intervention metrics.
   */
  app.get('/api/insights/summary', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { days?: string };
    const days = Math.min(Number(query.days) || 30, 90);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      totalIncidents,
      resolvedIncidents,
      totalRuns,
      completedRuns,
      failedRuns,
      quarantinedRuns,
      totalProposals,
      approvedProposals,
      deniedProposals,
      totalApprovals,
      humanApprovals,
    ] = await Promise.all([
      prisma.incident.count({ where: { createdAt: { gte: since } } }),
      prisma.incident.count({ where: { createdAt: { gte: since }, status: 'resolved' } }),
      prisma.run.count({ where: { createdAt: { gte: since } } }),
      prisma.run.count({ where: { createdAt: { gte: since }, status: 'completed' } }),
      prisma.run.count({ where: { createdAt: { gte: since }, status: 'failed' } }),
      prisma.run.count({ where: { createdAt: { gte: since }, status: 'quarantined' } }),
      prisma.proposal.count({ where: { createdAt: { gte: since } } }),
      prisma.proposal.count({ where: { createdAt: { gte: since }, status: { in: ['approved', 'executed', 'verified'] } } }),
      prisma.proposal.count({ where: { createdAt: { gte: since }, status: 'denied' } }),
      prisma.approval.count({ where: { createdAt: { gte: since } } }),
      prisma.approval.count({ where: { createdAt: { gte: since }, status: 'APPROVED' } }),
    ]);

    return reply.send({
      periodDays: days,
      incidents: { total: totalIncidents, resolved: resolvedIncidents },
      runs: { total: totalRuns, completed: completedRuns, failed: failedRuns, quarantined: quarantinedRuns },
      proposals: { total: totalProposals, approved: approvedProposals, denied: deniedProposals },
      approvals: { total: totalApprovals, humanApproved: humanApprovals },
      interventionRate: totalApprovals > 0
        ? Math.round((humanApprovals / totalApprovals) * 1000) / 10
        : 0,
    });
  });
}
