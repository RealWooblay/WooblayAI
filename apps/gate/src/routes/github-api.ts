/**
 * GitHub attribution API routes.
 *
 * GET /api/github/repos/:repoId/prs/:number/attribution
 * GET /api/github/agents/:pubkey/stats
 * GET /api/github/orgs/:installationId/overview
 * GET /api/github/prs (list with filters)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseJsonField<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function hoursBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60) * 10) / 10;
}

// ── Routes ───────────────────────────────────────────────────────────────────

export async function githubApiRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/github/repos/:repoId/prs/:number/attribution
   *
   * Full attribution detail for a single PR.
   */
  app.get(
    '/api/github/repos/:repoId/prs/:number/attribution',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { repoId, number } = request.params as { repoId: string; number: string };
      const prNumber = parseInt(number, 10);

      try {
        const pr = await prisma.gitHubPR.findUnique({
          where: { repoId_number: { repoId, number: prNumber } },
          include: {
            attribution: true,
            commits: { orderBy: { createdAt: 'asc' } },
            events: { orderBy: { createdAt: 'asc' } },
            checkResults: { orderBy: { createdAt: 'desc' } },
            taskLinks: true,
            repo: true,
          },
        });

        if (!pr) {
          return reply.code(404).send({ error: 'PR not found' });
        }

        // Compute derived metrics
        const timeToMergeHours =
          pr.mergedAt && pr.createdAt
            ? hoursBetween(pr.createdAt, pr.mergedAt)
            : null;

        const reviewCycles = pr.events.filter(
          (e) => e.eventType === 'review',
        ).length;

        const ciFailureCount = pr.checkResults.filter(
          (c) => c.conclusion === 'failure',
        ).length;

        // Deserialize JSON fields in attribution
        const attribution = pr.attribution
          ? {
              ...pr.attribution,
              agentCommitShas: parseJsonField<string[]>(pr.attribution.agentCommitShas, []),
              humanCommitShas: parseJsonField<string[]>(pr.attribution.humanCommitShas, []),
              interventionBreakdown: parseJsonField(pr.attribution.interventionBreakdown, null),
              computedAt: pr.attribution.computedAt.toISOString(),
            }
          : null;

        return reply.send({
          pr: {
            ...pr,
            createdAt: pr.createdAt.toISOString(),
            mergedAt: pr.mergedAt?.toISOString() ?? null,
            closedAt: pr.closedAt?.toISOString() ?? null,
            updatedAt: pr.updatedAt.toISOString(),
            repo: undefined,
            attribution: undefined,
            commits: undefined,
            events: undefined,
            checkResults: undefined,
            taskLinks: undefined,
          },
          attribution,
          commits: pr.commits.map((c) => ({
            ...c,
            createdAt: c.createdAt.toISOString(),
          })),
          events: pr.events.map((e) => ({
            ...e,
            payload: e.payload,
            createdAt: e.createdAt.toISOString(),
          })),
          checkResults: pr.checkResults.map((c) => ({
            ...c,
            startedAt: c.startedAt?.toISOString() ?? null,
            completedAt: c.completedAt?.toISOString() ?? null,
            createdAt: c.createdAt.toISOString(),
          })),
          taskLinks: pr.taskLinks.map((l) => ({
            ...l,
            receiptHashes: parseJsonField<string[]>(l.receiptHashes, [] as string[]),
            createdAt: l.createdAt.toISOString(),
          })),
          metrics: {
            timeToMergeHours,
            reviewCycles,
            ciFailureCount,
          },
        });
      } catch (err) {
        request.log.error(err, 'Failed to get PR attribution');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/github/agents/:pubkey/stats
   *
   * Aggregate GitHub stats for an agent.
   */
  app.get(
    '/api/github/agents/:pubkey/stats',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { pubkey } = request.params as { pubkey: string };

      try {
        const prs = await prisma.gitHubPR.findMany({
          where: { agentPubkey: pubkey, isAgentPR: true },
          include: {
            attribution: true,
            events: true,
            checkResults: true,
          },
        });

        if (prs.length === 0) {
          return reply.send({
            agentPubkey: pubkey,
            totalPRs: 0,
            mergedPRs: 0,
            avgInterventionScore: 0,
            avgTimeToMergeHours: null,
            avgReviewCycles: 0,
            avgCIFailures: 0,
            revertRate: 0,
            totalAgentLOC: 0,
            totalHumanLOC: 0,
            interventionRate: 0,
            avgReceiptCoverage: null,
          });
        }

        const mergedPRs = prs.filter((p) => p.state === 'merged');
        const withAttribution = prs.filter((p) => p.attribution);

        // Time to merge (only for merged PRs)
        const mergeTimes = mergedPRs
          .filter((p) => p.mergedAt)
          .map((p) => hoursBetween(p.createdAt, p.mergedAt!));
        const avgTimeToMergeHours =
          mergeTimes.length > 0
            ? Math.round((mergeTimes.reduce((a, b) => a + b, 0) / mergeTimes.length) * 10) / 10
            : null;

        // Review cycles
        const reviewCounts = prs.map(
          (p) => p.events.filter((e) => e.eventType === 'review').length,
        );
        const avgReviewCycles =
          Math.round((reviewCounts.reduce((a, b) => a + b, 0) / prs.length) * 10) / 10;

        // CI failures
        const ciFailureCounts = prs.map(
          (p) => p.checkResults.filter((c) => c.conclusion === 'failure').length,
        );
        const avgCIFailures =
          Math.round((ciFailureCounts.reduce((a, b) => a + b, 0) / prs.length) * 10) / 10;

        // Attribution aggregates
        let totalAgentLOC = 0;
        let totalHumanLOC = 0;
        let totalInterventionScore = 0;
        let interventionCount = 0;
        const coverages: number[] = [];

        for (const p of withAttribution) {
          const attr = p.attribution!;
          totalAgentLOC += attr.agentLOC;
          totalHumanLOC += attr.humanLOC;
          totalInterventionScore += attr.interventionScore;
          if (attr.interventionScore > 0) interventionCount++;
          if (attr.receiptCoverage !== null) coverages.push(attr.receiptCoverage);
        }

        const avgInterventionScore =
          withAttribution.length > 0
            ? Math.round((totalInterventionScore / withAttribution.length) * 10) / 10
            : 0;

        // Revert rate — PRs with intervention factor "reverted"
        const revertedCount = withAttribution.filter((p) => {
          const breakdown = parseJsonField<Array<{ factor: string; triggered: boolean }>>(
            p.attribution!.interventionBreakdown,
            [],
          );
          return breakdown.some((f) => f.factor === 'reverted' && f.triggered);
        }).length;

        return reply.send({
          agentPubkey: pubkey,
          totalPRs: prs.length,
          mergedPRs: mergedPRs.length,
          avgInterventionScore,
          avgTimeToMergeHours,
          avgReviewCycles,
          avgCIFailures,
          revertRate: prs.length > 0 ? Math.round((revertedCount / prs.length) * 100) / 100 : 0,
          totalAgentLOC,
          totalHumanLOC,
          interventionRate:
            withAttribution.length > 0
              ? Math.round((interventionCount / withAttribution.length) * 100) / 100
              : 0,
          avgReceiptCoverage:
            coverages.length > 0
              ? Math.round((coverages.reduce((a, b) => a + b, 0) / coverages.length) * 100) / 100
              : null,
        });
      } catch (err) {
        request.log.error(err, 'Failed to get agent GitHub stats');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/github/orgs/:installationId/overview
   *
   * Organization-level trends and leaderboard.
   */
  app.get(
    '/api/github/orgs/:installationId/overview',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { installationId } = request.params as { installationId: string };

      try {
        const installation = await prisma.gitHubInstallation.findUnique({
          where: { id: installationId },
          include: { repos: true },
        });

        if (!installation) {
          return reply.code(404).send({ error: 'Installation not found' });
        }

        const repoIds = installation.repos.map((r) => r.id);

        // Get all agent PRs for this org from the last 30 days
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const prs = await prisma.gitHubPR.findMany({
          where: {
            repoId: { in: repoIds },
            isAgentPR: true,
            createdAt: { gte: thirtyDaysAgo },
          },
          include: { attribution: true },
          orderBy: { createdAt: 'desc' },
        });

        // Intervention trend — bucketed by week
        const weekBuckets = new Map<string, { scores: number[]; count: number }>();
        for (const pr of prs) {
          const weekStart = new Date(pr.createdAt);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay());
          weekStart.setHours(0, 0, 0, 0);
          const key = weekStart.toISOString().split('T')[0]!;

          const bucket = weekBuckets.get(key) ?? { scores: [], count: 0 };
          bucket.count++;
          if (pr.attribution) {
            bucket.scores.push(pr.attribution.interventionScore);
          }
          weekBuckets.set(key, bucket);
        }

        const interventionTrend = Array.from(weekBuckets.entries())
          .map(([weekStart, bucket]) => ({
            weekStart,
            avgScore:
              bucket.scores.length > 0
                ? Math.round(
                    (bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length) * 10,
                  ) / 10
                : 0,
            prCount: bucket.count,
          }))
          .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

        // Top intervened PRs
        const topIntervenedPRs = prs
          .filter((p) => p.attribution && p.attribution.interventionScore > 0)
          .sort((a, b) => (b.attribution?.interventionScore ?? 0) - (a.attribution?.interventionScore ?? 0))
          .slice(0, 5)
          .map((p) => ({
            pr: {
              ...p,
              createdAt: p.createdAt.toISOString(),
              mergedAt: p.mergedAt?.toISOString() ?? null,
              closedAt: p.closedAt?.toISOString() ?? null,
              updatedAt: p.updatedAt.toISOString(),
              attribution: undefined,
            },
            interventionScore: p.attribution?.interventionScore ?? 0,
          }));

        // Agent leaderboard
        const agentMap = new Map<string, { prCount: number; scores: number[]; merged: number }>();
        for (const pr of prs) {
          if (!pr.agentPubkey) continue;
          const entry = agentMap.get(pr.agentPubkey) ?? { prCount: 0, scores: [], merged: 0 };
          entry.prCount++;
          if (pr.attribution) entry.scores.push(pr.attribution.interventionScore);
          if (pr.state === 'merged') entry.merged++;
          agentMap.set(pr.agentPubkey, entry);
        }

        // Look up agent names
        const pubkeys = Array.from(agentMap.keys());
        const agents = await prisma.agent.findMany({
          where: { pubkey: { in: pubkeys } },
          select: { pubkey: true, name: true },
        });
        const nameMap = new Map(agents.map((a) => [a.pubkey, a.name]));

        const agentLeaderboard = Array.from(agentMap.entries())
          .map(([pubkey, data]) => ({
            agentPubkey: pubkey,
            agentName: nameMap.get(pubkey),
            prCount: data.prCount,
            avgInterventionScore:
              data.scores.length > 0
                ? Math.round(
                    (data.scores.reduce((a, b) => a + b, 0) / data.scores.length) * 10,
                  ) / 10
                : 0,
            mergeRate: data.prCount > 0 ? Math.round((data.merged / data.prCount) * 100) / 100 : 0,
          }))
          .sort((a, b) => a.avgInterventionScore - b.avgInterventionScore);

        // Average metrics
        const allScores = prs
          .filter((p) => p.attribution)
          .map((p) => p.attribution!.interventionScore);
        const coverages = prs
          .filter((p) => p.attribution?.receiptCoverage !== null)
          .map((p) => p.attribution!.receiptCoverage!);

        return reply.send({
          installationId,
          accountLogin: installation.accountLogin,
          interventionTrend,
          topIntervenedPRs,
          agentLeaderboard,
          avgMetrics: {
            avgInterventionScore:
              allScores.length > 0
                ? Math.round((allScores.reduce((a, b) => a + b, 0) / allScores.length) * 10) / 10
                : 0,
            avgTimeToMergeHours: null, // Would need merged PRs + createdAt computation
            interventionRate:
              allScores.length > 0
                ? Math.round(
                    (allScores.filter((s) => s > 0).length / allScores.length) * 100,
                  ) / 100
                : 0,
            avgReceiptCoverage:
              coverages.length > 0
                ? Math.round((coverages.reduce((a, b) => a + b, 0) / coverages.length) * 100) / 100
                : null,
          },
        });
      } catch (err) {
        request.log.error(err, 'Failed to get org overview');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * GET /api/github/prs
   *
   * List agent PRs with filters.
   */
  app.get(
    '/api/github/prs',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        agentPubkey?: string;
        state?: string;
        minIntervention?: string;
        repo?: string;
        page?: string;
        pageSize?: string;
      };

      const page = Math.max(1, parseInt(query.page ?? '1', 10));
      const pageSize = Math.min(100, Math.max(1, parseInt(query.pageSize ?? '20', 10)));
      const skip = (page - 1) * pageSize;

      try {
        // Build where clause
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const where: Record<string, any> = { isAgentPR: true };

        if (query.agentPubkey) where.agentPubkey = query.agentPubkey;
        if (query.state) where.state = query.state;
        if (query.repo) {
          const repo = await prisma.gitHubRepo.findUnique({
            where: { fullName: query.repo },
          });
          if (repo) where.repoId = repo.id;
        }

        // Intervention filter requires a join
        const minIntervention = query.minIntervention
          ? parseInt(query.minIntervention, 10)
          : undefined;

        if (minIntervention !== undefined) {
          where.attribution = {
            interventionScore: { gte: minIntervention },
          };
        }

        const [data, total] = await Promise.all([
          prisma.gitHubPR.findMany({
            where,
            include: {
              attribution: true,
              repo: { select: { fullName: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: pageSize,
          }),
          prisma.gitHubPR.count({ where }),
        ]);

        return reply.send({
          data: data.map((p) => ({
            ...p,
            repoFullName: p.repo.fullName,
            createdAt: p.createdAt.toISOString(),
            mergedAt: p.mergedAt?.toISOString() ?? null,
            closedAt: p.closedAt?.toISOString() ?? null,
            updatedAt: p.updatedAt.toISOString(),
            attribution: p.attribution
              ? {
                  ...p.attribution,
                  agentCommitShas: parseJsonField<string[]>(p.attribution.agentCommitShas, []),
                  humanCommitShas: parseJsonField<string[]>(p.attribution.humanCommitShas, []),
                  interventionBreakdown: parseJsonField(p.attribution.interventionBreakdown, null),
                  computedAt: p.attribution.computedAt.toISOString(),
                }
              : null,
            repo: undefined,
          })),
          total,
          page,
          pageSize,
        });
      } catch (err) {
        request.log.error(err, 'Failed to list GitHub PRs');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );
}
