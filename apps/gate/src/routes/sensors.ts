/**
 * Sensor routes — webhook ingestion + sensor management.
 *
 * Per-connection webhook endpoints for deterministic org resolution.
 * Sensor management: toggle, configure, view webhook URLs.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { processGitHubWebhook } from '../engine/sensor.js';
import { routeOperation } from '../engine/router.js';
import { createRun } from '../engine/orchestrator.js';
import { verifyGitHubWebhookSignature } from '../middleware/verify-github-webhook.js';
import { getOrgScope } from '../middleware/org-scope.js';
import { config } from '../config.js';
import { DEFAULT_GITHUB_SENSOR_CONFIG, type GitHubSensorConfig } from '@wooblay/types';

const INTENT_TO_RECIPE: Record<string, string> = {
  fix: 'ci_replay',
  qa: 'qa',
  review: 'review',
  deploy: 'deploy',
  custom: 'ci_replay',
};

// ── Per-Connection Webhook Signature Verification ───────────────────────

function verifyConnectionWebhookSignature(
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string,
): boolean {
  const signatureHeader = request.headers['x-hub-signature-256'] as string | undefined;

  if (!signatureHeader) {
    if (config.NODE_ENV !== 'production') {
      request.log.warn('Missing X-Hub-Signature-256 — skipping in dev');
      return true;
    }
    reply.code(401).send({ error: 'Missing webhook signature' });
    return false;
  }

  const rawBody = typeof request.body === 'string'
    ? request.body
    : JSON.stringify(request.body);

  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const sigBuffer = Buffer.from(signatureHeader, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    reply.code(401).send({ error: 'Invalid webhook signature' });
    return false;
  }

  return true;
}

export async function sensorRoutes(app: FastifyInstance): Promise<void> {
  // ── Per-Connection Webhook Endpoint ─────────────────────────────────
  app.post('/api/webhooks/github/:connectionId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { connectionId } = request.params as { connectionId: string };

    // Load connection
    const connection = await prisma.connection.findUnique({
      where: { id: connectionId },
    });

    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    if (!connection.sensorEnabled) {
      return reply.send({ processed: false, message: 'Sensor disabled for this connection' });
    }

    // Verify signature against connection's webhook secret
    if (connection.webhookSecret) {
      if (!verifyConnectionWebhookSignature(request, reply, connection.webhookSecret)) {
        return;
      }
    }

    const eventType = request.headers['x-github-event'] as string | undefined;
    const deliveryId = request.headers['x-github-delivery'] as string | undefined;

    if (!eventType) {
      return reply.code(400).send({ error: 'Missing X-GitHub-Event header' });
    }

    // Replay protection
    if (deliveryId) {
      try {
        await prisma.webhookDelivery.create({
          data: { deliveryId, eventType },
        });
      } catch (err: any) {
        if (err.code === 'P2002') {
          return reply.send({ processed: false, deduplicated: true, message: `Duplicate delivery: ${deliveryId}` });
        }
        throw err;
      }
    }

    // Parse sensor config
    let sensorConfig: GitHubSensorConfig | null = null;
    if (connection.sensorConfig) {
      try {
        sensorConfig = JSON.parse(connection.sensorConfig) as GitHubSensorConfig;
      } catch {
        sensorConfig = null;
      }
    }

    try {
      const result = await processGitHubWebhook(prisma, eventType, request.body, {
        connectionId: connection.id,
        orgId: connection.orgId ?? undefined,
        sensorConfig,
      });

      if (result.deduplicated) {
        return reply.send({ processed: true, sensor: result.sensor, deduplicated: true });
      }

      if (!result.operationId) {
        return reply.send({ processed: true, sensor: null, message: 'No sensor matched this event' });
      }

      // Route the operation to the best agent
      const operation = await prisma.operation.findUnique({ where: { id: result.operationId } });
      let routingResult = null;
      if (operation) {
        try {
          routingResult = await routeOperation(prisma, operation);
        } catch (err: any) {
          request.log.warn(err, 'Failed to route operation');
        }
      }

      // Auto-create run if routed and config says so
      let runId: string | null = null;
      const shouldAutoRun = sensorConfig?.autoCreateRun !== false;
      if (shouldAutoRun && routingResult?.status === 'auto_routed' && operation) {
        const recipe = INTENT_TO_RECIPE[operation.intent] ?? 'ci_replay';
        try {
          const run = await createRun(prisma, { operationId: result.operationId, recipe });
          runId = run.id;
        } catch (err: any) {
          request.log.warn(err, 'Failed to auto-create run');
        }
      }

      return reply.send({
        processed: true,
        sensor: result.sensor,
        operationId: result.operationId,
        intent: operation?.intent,
        routing: routingResult ? {
          instanceId: routingResult.instanceId,
          confidence: routingResult.confidence,
          status: routingResult.status,
          reason: routingResult.reason,
        } : null,
        runId,
      });
    } catch (err: any) {
      request.log.error(err, 'Failed to process webhook');
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });

  // ── Legacy Global Webhook (fallback) ────────────────────────────────
  app.post('/api/webhooks/github', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!verifyGitHubWebhookSignature(request, reply)) return;

    const eventType = request.headers['x-github-event'] as string | undefined;
    const deliveryId = request.headers['x-github-delivery'] as string | undefined;

    if (!eventType) {
      return reply.code(400).send({ error: 'Missing X-GitHub-Event header' });
    }

    if (deliveryId) {
      try {
        await prisma.webhookDelivery.create({ data: { deliveryId, eventType } });
      } catch (err: any) {
        if (err.code === 'P2002') {
          return reply.send({ processed: false, deduplicated: true, message: `Duplicate delivery: ${deliveryId}` });
        }
        throw err;
      }
    }

    try {
      const result = await processGitHubWebhook(prisma, eventType, request.body);

      if (result.deduplicated) {
        return reply.send({ processed: true, sensor: result.sensor, deduplicated: true });
      }

      if (!result.operationId) {
        return reply.send({ processed: true, sensor: null, message: 'No sensor matched this event' });
      }

      const operation = await prisma.operation.findUnique({ where: { id: result.operationId } });
      const recipe = INTENT_TO_RECIPE[operation?.intent ?? 'fix'] ?? 'ci_replay';

      let runId: string | null = null;
      try {
        const run = await createRun(prisma, { operationId: result.operationId, recipe });
        runId = run.id;
      } catch (err: any) {
        request.log.warn(err, 'Failed to auto-create run');
      }

      return reply.send({
        processed: true,
        sensor: result.sensor,
        operationId: result.operationId,
        incidentId: result.operationId,
        intent: operation?.intent,
        recipe,
        runId,
      });
    } catch (err: any) {
      request.log.error(err, 'Failed to process GitHub webhook');
      return reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });

  // ── Sensor Status (from Connection model) ───────────────────────────
  app.get('/api/sensors/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const org = getOrgScope(request);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Get all connections (sensors)
    const connections = await prisma.connection.findMany({
      where: { ...org.filter, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });

    // Get operation counts per connection and total
    const sensors = await Promise.all(
      connections.map(async (conn) => {
        const opsCount = await prisma.operation.count({
          where: {
            connectionId: conn.id,
            createdAt: { gte: oneDayAgo },
          },
        });

        let parsedConfig: GitHubSensorConfig | null = null;
        if (conn.sensorConfig) {
          try { parsedConfig = JSON.parse(conn.sensorConfig); } catch { /* ignore */ }
        }

        return {
          id: conn.id,
          name: conn.name,
          provider: conn.provider,
          status: conn.status,
          sensorEnabled: conn.sensorEnabled,
          sensorConfig: parsedConfig,
          operationsLast24h: opsCount,
          hasWebhookSecret: !!conn.webhookSecret,
          createdAt: conn.createdAt,
        };
      }),
    );

    const totalOps = await prisma.operation.count({
      where: { ...org.filter, createdAt: { gte: oneDayAgo } },
    });

    return reply.send({ sensors, totalOperationsLast24h: totalOps });
  });

  // ── Toggle Sensor + Update Config ───────────────────────────────────
  app.patch('/api/connections/:id/sensor', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      sensorEnabled?: boolean;
      sensorConfig?: GitHubSensorConfig;
    };

    const connection = await prisma.connection.findUnique({ where: { id } });
    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const data: Record<string, unknown> = {};
    if (body.sensorEnabled !== undefined) data.sensorEnabled = body.sensorEnabled;
    if (body.sensorConfig !== undefined) {
      data.sensorConfig = JSON.stringify(body.sensorConfig);
    }

    // Auto-generate webhook secret if enabling sensor for the first time
    if (body.sensorEnabled && !connection.webhookSecret) {
      data.webhookSecret = randomBytes(32).toString('hex');
    }

    const updated = await prisma.connection.update({ where: { id }, data });

    return reply.send({
      id: updated.id,
      sensorEnabled: updated.sensorEnabled,
      sensorConfig: updated.sensorConfig ? JSON.parse(updated.sensorConfig) : null,
      hasWebhookSecret: !!updated.webhookSecret,
    });
  });

  // ── Get Webhook URL + Secret for a Connection ──────────────────────
  app.get('/api/connections/:id/webhook-url', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const connection = await prisma.connection.findUnique({ where: { id } });
    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    // Generate webhook secret if it doesn't exist
    if (!connection.webhookSecret) {
      const secret = randomBytes(32).toString('hex');
      await prisma.connection.update({
        where: { id },
        data: { webhookSecret: secret },
      });
      connection.webhookSecret = secret;
    }

    const baseUrl = config.NODE_ENV === 'production'
      ? config.WOOBLAY_DASHBOARD_URL.replace(/\/$/, '')
      : `http://localhost:${config.PORT}`;

    return reply.send({
      webhookUrl: `${baseUrl}/api/webhooks/github/${connection.id}`,
      webhookSecret: connection.webhookSecret,
      instructions: {
        step1: 'Go to your GitHub repository Settings > Webhooks > Add webhook',
        step2: `Paste this Payload URL: ${baseUrl}/api/webhooks/github/${connection.id}`,
        step3: 'Content type: application/json',
        step4: `Paste this Secret: ${connection.webhookSecret}`,
        step5: 'Select events: Push, Pull requests, Check runs',
      },
    });
  });

  // ── Initialize sensor with default config ──────────────────────────
  app.post('/api/connections/:id/sensor/init', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    const connection = await prisma.connection.findUnique({ where: { id } });
    if (!connection) {
      return reply.code(404).send({ error: 'Connection not found' });
    }

    const webhookSecret = connection.webhookSecret || randomBytes(32).toString('hex');

    const updated = await prisma.connection.update({
      where: { id },
      data: {
        sensorEnabled: true,
        sensorConfig: JSON.stringify(DEFAULT_GITHUB_SENSOR_CONFIG),
        webhookSecret,
      },
    });

    const baseUrl = config.NODE_ENV === 'production'
      ? config.WOOBLAY_DASHBOARD_URL.replace(/\/$/, '')
      : `http://localhost:${config.PORT}`;

    return reply.send({
      id: updated.id,
      sensorEnabled: true,
      sensorConfig: DEFAULT_GITHUB_SENSOR_CONFIG,
      webhookUrl: `${baseUrl}/api/webhooks/github/${connection.id}`,
      webhookSecret,
    });
  });
}
