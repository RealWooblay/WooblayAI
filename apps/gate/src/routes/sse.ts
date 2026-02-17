/**
 * Server-Sent Events (SSE) endpoint for real-time event streaming.
 *
 * Clients connect to GET /api/events/stream and receive a live feed of
 * all Wooblay events — tool calls, policy decisions, simulation results,
 * secure execution events, approvals, and operation updates.
 *
 * Auth: SSE uses the standard Clerk JWT passed via:
 *   - Authorization header (fetch-based SSE)
 *   - __session cookie (browser fallback)
 * The Clerk auth middleware handles both automatically.
 *
 * Supports:
 * - Type filtering: ?types=operation.created,secure_exec.completed
 * - Replay from ID: ?since=42
 * - Auto-reconnect (EventSource standard)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventBus } from '../events/bus.js';
import { prisma } from '../db/client.js';
import type { WooblayEvent } from '@wooblay/types';

export async function sseRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/events/stream — SSE event stream
   *
   * Query params:
   *   types — comma-separated event types to filter (optional)
   *   since — replay events since this EventLog ID (optional)
   *   runId — filter events for a specific run (optional)
   *   operationId — filter events for a specific operation (optional)
   */
  app.get('/api/events/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    // Auth is handled by Clerk middleware (JWT or cookie).
    // If we get here, the user is authenticated.

    const query = request.query as {
      types?: string;
      since?: string;
      runId?: string;
      operationId?: string;
    };

    const allowedTypes = query.types?.split(',').filter(Boolean) ?? [];
    const sinceId = query.since ? parseInt(query.since, 10) : null;
    const filterRunId = query.runId ?? null;
    const filterOperationId = query.operationId ?? null;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Replay missed events if `since` is specified
    if (sinceId) {
      try {
        const missed = await prisma.eventLog.findMany({
          where: {
            id: { gt: sinceId },
            ...(allowedTypes.length > 0 ? { type: { in: allowedTypes } } : {}),
          },
          orderBy: { id: 'asc' },
          take: 500,
        });

        for (const event of missed) {
          const data = JSON.stringify({
            type: event.type,
            data: JSON.parse(event.data),
            timestamp: event.createdAt.toISOString(),
          });
          reply.raw.write(`id: ${event.id}\ndata: ${data}\n\n`);
        }
      } catch (err: any) {
        request.log.warn(err, 'SSE replay failed');
      }
    }

    // Subscribe to live events
    function onEvent(event: WooblayEvent): void {
      // Type filter
      if (allowedTypes.length > 0 && !allowedTypes.includes(event.type)) {
        return;
      }

      // Run filter
      if (filterRunId && (event.data as any)?.runId !== filterRunId) {
        return;
      }

      // Operation filter
      if (filterOperationId && (event.data as any)?.operationId !== filterOperationId) {
        return;
      }

      const data = JSON.stringify({
        type: event.type,
        data: event.data,
        timestamp: new Date().toISOString(),
      });

      try {
        reply.raw.write(`data: ${data}\n\n`);
      } catch {
        // Client disconnected
      }
    }

    eventBus.on('*', onEvent);

    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      eventBus.off('*', onEvent);
      clearInterval(heartbeat);
    });
  });
}
