/**
 * Sensor routes — GitHub webhook ingestion.
 *
 * Receives GitHub webhooks for multiple event types:
 * - check_run → CI failure sensors (fix intent)
 * - pull_request → New PR sensor (qa intent)
 * - push → Push to default branch sensor (review intent)
 *
 * Creates incidents with appropriate intent, and auto-creates runs
 * with recipes matched to the intent.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { processGitHubWebhook } from '../engine/sensor.js';
import { createRun } from '../engine/orchestrator.js';
import { verifyGitHubWebhookSignature } from '../middleware/verify-github-webhook.js';

const INTENT_TO_RECIPE: Record<string, string> = {
  fix: 'ci_replay',
  qa: 'qa',
  review: 'review',
  deploy: 'deploy',
};

export async function sensorRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/webhooks/github
   *
   * GitHub webhook receiver. Processes check_run, pull_request,
   * and push events through the appropriate sensors.
   */
  app.post('/api/webhooks/github', async (request: FastifyRequest, reply: FastifyReply) => {
    // Validate webhook signature before any processing
    if (!verifyGitHubWebhookSignature(request, reply)) {
      return; // reply already sent by verifier
    }

    const eventType = request.headers['x-github-event'] as string | undefined;
    const deliveryId = request.headers['x-github-delivery'] as string | undefined;

    if (!eventType) {
      return reply.code(400).send({ error: 'Missing X-GitHub-Event header' });
    }

    // Replay protection: reject duplicate deliveries
    if (deliveryId) {
      try {
        await prisma.webhookDelivery.create({
          data: { deliveryId, eventType },
        });
      } catch (err: any) {
        // Unique constraint violation = duplicate delivery
        if (err.code === 'P2002') {
          return reply.send({
            processed: false,
            deduplicated: true,
            message: `Duplicate delivery: ${deliveryId}`,
          });
        }
        throw err;
      }
    }

    const payload = request.body;

    try {
      const result = await processGitHubWebhook(prisma, eventType, payload);

      if (result.deduplicated) {
        return reply.send({
          processed: true,
          sensor: result.sensor,
          deduplicated: true,
          message: 'Duplicate event within deduplication window',
        });
      }

      if (!result.incidentId) {
        return reply.send({
          processed: true,
          sensor: null,
          message: 'No sensor matched this event',
        });
      }

      // Determine recipe from incident intent
      const incident = await prisma.incident.findUnique({
        where: { id: result.incidentId },
      });
      const recipe = INTENT_TO_RECIPE[incident?.intent ?? 'fix'] ?? 'ci_replay';

      // Auto-create a run for the incident
      let runId: string | null = null;
      try {
        const run = await createRun(prisma, {
          incidentId: result.incidentId,
          recipe,
        });
        runId = run.id;
      } catch (err: any) {
        request.log.warn(err, 'Failed to auto-create run for incident');
      }

      return reply.send({
        processed: true,
        sensor: result.sensor,
        incidentId: result.incidentId,
        intent: incident?.intent,
        recipe,
        runId,
      });
    } catch (err: any) {
      request.log.error(err, 'Failed to process GitHub webhook');
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });

  /**
   * GET /api/sensors/status
   *
   * Returns status of all active sensors.
   */
  app.get('/api/sensors/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [ciCount, agentPrCount, prOpenedCount, pushCount, totalIncidents] = await Promise.all([
      prisma.incident.count({ where: { source: 'github_ci', createdAt: { gte: oneDayAgo } } }),
      prisma.incident.count({ where: { source: 'github_agent_pr', createdAt: { gte: oneDayAgo } } }),
      prisma.incident.count({ where: { source: 'github_pr_opened', createdAt: { gte: oneDayAgo } } }),
      prisma.incident.count({ where: { source: 'github_push', createdAt: { gte: oneDayAgo } } }),
      prisma.incident.count({ where: { createdAt: { gte: oneDayAgo } } }),
    ]);

    return reply.send({
      sensors: [
        // Primary: context/action sensors (QA-first positioning)
        {
          name: 'New PR Sensor',
          id: 'github_pr_opened',
          enabled: true,
          primary: true,
          description: 'New PR opened or updated → Wooblay runs QA',
          intent: 'qa',
          incidentsLast24h: prOpenedCount,
        },
        {
          name: 'Push Sensor',
          id: 'github_push',
          enabled: true,
          primary: true,
          description: 'Push to default branch → code review',
          intent: 'review',
          incidentsLast24h: pushCount,
        },
        // Secondary: CI result ingestion (verification stage)
        {
          name: 'CI Failure Sensor',
          id: 'github_ci',
          enabled: true,
          primary: false,
          description: 'CI failure on default branch → fix (secondary)',
          intent: 'fix',
          incidentsLast24h: ciCount,
        },
        {
          name: 'Agent PR CI Sensor',
          id: 'github_agent_pr',
          enabled: true,
          primary: false,
          description: 'CI failure on agent-created PR → fix (secondary)',
          intent: 'fix',
          incidentsLast24h: agentPrCount,
        },
      ],
      totalIncidentsLast24h: totalIncidents,
    });
  });
}
