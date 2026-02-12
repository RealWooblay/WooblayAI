/**
 * Server-Sent Events plugin for Fastify.
 *
 * Exposes GET /api/events that streams WooblayEvents to connected clients.
 * Supports optional filtering by event type and replaying events since a
 * given event ID.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { eventBus } from './bus.js';
import type { WooblayEvent } from '@wooblay/types';

export async function ssePlugin(app: FastifyInstance): Promise<void> {
  app.get('/api/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { types?: string; since?: string };

    // Parse optional type filter
    const allowedTypes = query.types
      ? query.types.split(',').map((t) => t.trim()).filter(Boolean)
      : null;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx passthrough
    });

    // Helper to write an SSE frame
    const send = (id: string | number, event: WooblayEvent): void => {
      reply.raw.write(`id: ${id}\n`);
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event.data)}\n\n`);
    };

    // Replay events from EventLog since the given id
    if (query.since) {
      const sinceId = Number(query.since);
      if (!Number.isNaN(sinceId)) {
        const stored = await prisma.eventLog.findMany({
          where: {
            id: { gt: sinceId },
            ...(allowedTypes ? { type: { in: allowedTypes } } : {}),
          },
          orderBy: { id: 'asc' },
        });

        for (const row of stored) {
          const evt: WooblayEvent = {
            type: row.type as WooblayEvent['type'],
            data: JSON.parse(row.data),
          };
          send(row.id, evt);
        }
      }
    }

    // Stream new events in real time
    const handler = (event: WooblayEvent): void => {
      if (allowedTypes && !allowedTypes.includes(event.type)) return;
      // Use current timestamp as a best-effort event id
      send(Date.now(), event);
    };

    eventBus.on('*', handler);

    // Clean up when the client disconnects
    request.raw.on('close', () => {
      eventBus.off('*', handler);
      reply.raw.end();
    });

    // Keep the connection open — Fastify must not auto-close
    await reply.hijack();
  });
}
