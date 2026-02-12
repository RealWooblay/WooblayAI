/**
 * Receipt routes.
 *
 * Provides endpoints to retrieve and verify individual receipts as well as
 * verify contiguous segments of the receipt chain.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Receipt } from '@wooblay/types';
import { verifyReceipt, verifyChain } from '@wooblay/crypto';
import { config } from '../config.js';
import { prisma } from '../db/client.js';

/** Convert a Prisma receipt row into the domain Receipt shape. */
function toReceiptDomain(row: {
  id: string;
  toolCallId: string;
  agentPubkey: string;
  toolName: string;
  riskTier: string;
  policyDecision: string;
  policyRuleId: string | null;
  approvalDecision: string | null;
  approver: string | null;
  executionSummary: string | null;
  decisionTrail: string;
  chainPrev: string | null;
  timestamp: string;
  hash: string;
  signature: string;
  createdAt: Date;
}): Receipt {
  return {
    id: row.id,
    toolCallId: row.toolCallId,
    agentPubkey: row.agentPubkey,
    toolName: row.toolName,
    riskTier: row.riskTier,
    policyDecision: row.policyDecision,
    policyRuleId: row.policyRuleId,
    approvalDecision: row.approvalDecision,
    approver: row.approver,
    executionSummary: row.executionSummary ? JSON.parse(row.executionSummary) : null,
    decisionTrail: JSON.parse(row.decisionTrail),
    chainPrev: row.chainPrev,
    timestamp: row.timestamp,
    hash: row.hash,
    signature: row.signature,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function receiptRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/receipts/:hash — Retrieve a receipt by its content hash.
   */
  app.get('/api/receipts/:hash', async (request: FastifyRequest, reply: FastifyReply) => {
    const { hash } = request.params as { hash: string };

    try {
      const row = await prisma.receipt.findUnique({ where: { hash } });

      if (!row) {
        return reply.code(404).send({ error: 'Receipt not found' });
      }

      return reply.send(toReceiptDomain(row));
    } catch (err) {
      request.log.error(err, 'Failed to get receipt');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/receipts/:hash/verify — Verify a single receipt's hash + signature.
   */
  app.get('/api/receipts/:hash/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const { hash } = request.params as { hash: string };

    try {
      const row = await prisma.receipt.findUnique({ where: { hash } });

      if (!row) {
        return reply.code(404).send({ error: 'Receipt not found' });
      }

      const receipt = toReceiptDomain(row);
      const valid = verifyReceipt(receipt, config.WOOBLAY_SERVER_PUBLIC_KEY);

      return reply.send({ valid, hash: receipt.hash });
    } catch (err) {
      request.log.error(err, 'Failed to verify receipt');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/receipts/chain/verify — Verify a contiguous chain segment.
   *
   * Query params:
   *   from — starting receipt hash (inclusive)
   *   to   — ending receipt hash (inclusive)
   */
  app.get('/api/receipts/chain/verify', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { from?: string; to?: string };

    try {
      // Build the query range
      const where: Record<string, unknown> = {};

      if (query.from || query.to) {
        const fromReceipt = query.from
          ? await prisma.receipt.findUnique({ where: { hash: query.from } })
          : null;
        const toReceipt = query.to
          ? await prisma.receipt.findUnique({ where: { hash: query.to } })
          : null;

        if (query.from && !fromReceipt) {
          return reply.code(404).send({ error: 'from receipt not found' });
        }
        if (query.to && !toReceipt) {
          return reply.code(404).send({ error: 'to receipt not found' });
        }

        where['createdAt'] = {
          ...(fromReceipt ? { gte: fromReceipt.createdAt } : {}),
          ...(toReceipt ? { lte: toReceipt.createdAt } : {}),
        };
      }

      const rows = await prisma.receipt.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });

      if (rows.length === 0) {
        return reply.send({ valid: true, count: 0 });
      }

      const receipts = rows.map(toReceiptDomain);
      const result = verifyChain(receipts, config.WOOBLAY_SERVER_PUBLIC_KEY);

      return reply.send({
        valid: result.valid,
        count: receipts.length,
        brokenAt: result.brokenAt,
      });
    } catch (err) {
      request.log.error(err, 'Failed to verify chain');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
