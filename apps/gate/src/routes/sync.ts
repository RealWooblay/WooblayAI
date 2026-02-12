/**
 * Event sync routes (platform mode only).
 *
 * Per-instance Gates push receipts and approval events to the central platform
 * so the dashboard shows aggregated data and the audit trail survives instance deletion.
 *
 * POST /api/sync/events — Receive a batch of events from an instance Gate.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { config } from '../config.js';

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  if (!config.PLATFORM_MODE) return;

  /**
   * POST /api/sync/events — Receive synced events from an instance.
   *
   * Body: {
   *   instanceToken: string,     // shared secret proving identity
   *   instanceId: string,
   *   receipts: Array<{
   *     receiptHash: string,
   *     agentPubkey?: string,
   *     toolName?: string,
   *     riskTier?: string,
   *     decision?: string,
   *     data: string              // JSON — full receipt payload
   *   }>
   * }
   */
  app.post('/api/sync/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      instanceToken?: string;
      instanceId?: string;
      receipts?: Array<{
        receiptHash: string;
        agentPubkey?: string;
        toolName?: string;
        riskTier?: string;
        decision?: string;
        data: string;
      }>;
    };

    if (!body.instanceId || !body.instanceToken) {
      return reply.code(400).send({ error: 'Missing instanceId or instanceToken' });
    }

    // Verify instance exists and token matches
    const instance = await prisma.instance.findUnique({ where: { id: body.instanceId } });
    if (!instance) {
      return reply.code(404).send({ error: 'Instance not found' });
    }

    // Verify instance token from configJson
    const instanceConfig = instance.configJson ? JSON.parse(instance.configJson) : {};
    if (instanceConfig.syncToken !== body.instanceToken) {
      return reply.code(403).send({ error: 'Invalid instance token' });
    }

    try {
      const receipts = body.receipts ?? [];
      let synced = 0;

      for (const r of receipts) {
        try {
          await prisma.syncedReceipt.upsert({
            where: {
              instanceId_receiptHash: {
                instanceId: body.instanceId,
                receiptHash: r.receiptHash,
              },
            },
            create: {
              instanceId: body.instanceId,
              receiptHash: r.receiptHash,
              agentPubkey: r.agentPubkey ?? null,
              toolName: r.toolName ?? null,
              riskTier: r.riskTier ?? null,
              decision: r.decision ?? null,
              data: r.data,
            },
            update: {}, // Already synced, skip
          });
          synced++;
        } catch (err) {
          request.log.warn({ err, receiptHash: r.receiptHash }, 'Failed to sync individual receipt');
        }
      }

      return reply.send({ ok: true, synced });
    } catch (err) {
      request.log.error(err, 'Event sync failed');
      return reply.code(500).send({ error: 'Sync failed' });
    }
  });
}
