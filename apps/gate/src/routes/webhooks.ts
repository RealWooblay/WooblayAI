/**
 * Webhook management routes.
 *
 * CRUD for webhook URL + event subscription configuration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/webhooks — List user's webhooks.
   */
  app.get('/api/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).clerkUserId ?? 'anonymous';
    try {
      const webhooks = await prisma.webhook.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send(webhooks);
    } catch (err) {
      request.log.error(err, 'Failed to list webhooks');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/webhooks — Create a webhook.
   */
  app.post('/api/webhooks', async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = (request as any).clerkUserId ?? 'anonymous';
    const body = request.body as {
      url: string;
      events: string[];
    };

    if (!body.url || !body.events || !Array.isArray(body.events)) {
      return reply.code(400).send({ error: 'url and events[] are required' });
    }

    try {
      const webhook = await prisma.webhook.create({
        data: {
          userId,
          url: body.url,
          events: JSON.stringify(body.events),
          active: true,
        },
      });
      return reply.code(201).send(webhook);
    } catch (err) {
      request.log.error(err, 'Failed to create webhook');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * PATCH /api/webhooks/:id — Update a webhook.
   */
  app.patch('/api/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      url?: string;
      events?: string[];
      active?: boolean;
    };

    try {
      const webhook = await prisma.webhook.update({
        where: { id },
        data: {
          ...(body.url !== undefined && { url: body.url }),
          ...(body.events !== undefined && { events: JSON.stringify(body.events) }),
          ...(body.active !== undefined && { active: body.active }),
        },
      });
      return reply.send(webhook);
    } catch (err) {
      request.log.error(err, 'Failed to update webhook');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/webhooks/:id — Delete a webhook.
   */
  app.delete('/api/webhooks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      await prisma.webhook.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err) {
      request.log.error(err, 'Failed to delete webhook');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/webhooks/:id/test — Send a test payload.
   */
  app.post('/api/webhooks/:id/test', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    try {
      const webhook = await prisma.webhook.findUnique({ where: { id } });
      if (!webhook) return reply.code(404).send({ error: 'Webhook not found' });

      const testPayload = {
        event: 'test',
        description: 'This is a test notification from Wooblay',
        timestamp: new Date().toISOString(),
        data: { webhookId: id },
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Wooblay-Webhooks/1.0',
        },
        body: JSON.stringify(testPayload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return reply.send({
        success: response.ok,
        status: response.status,
        statusText: response.statusText,
      });
    } catch (err) {
      request.log.error(err, 'Failed to test webhook');
      return reply.send({
        success: false,
        error: String(err),
      });
    }
  });
}
