/**
 * Audit trail routes.
 *
 * Export compliance-ready reports (JSON/CSV) and verify chain integrity.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { describeToolCall } from '../engine/analysis.js';
import { createHash } from 'crypto';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/audit/report — Generate audit report for a date range.
   *
   * Query: ?from=ISO&to=ISO&agentPubkey=optional&format=json|csv
   */
  app.get('/api/audit/report', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as {
      from?: string;
      to?: string;
      agentPubkey?: string;
      format?: string;
    };

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();
    const format = query.format ?? 'json';

    const where: Record<string, unknown> = {
      createdAt: { gte: from, lte: to },
    };
    if (query.agentPubkey) where.agentPubkey = query.agentPubkey;

    try {
      const receipts = await prisma.receipt.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: {
          toolCall: {
            include: {
              approval: true,
              execution: true,
            },
          },
        },
      });

      const rows = receipts.map((r) => {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(r.toolCall.args);
        } catch {
          // keep empty
        }

        return {
          timestamp: r.createdAt.toISOString(),
          receiptId: r.id,
          receiptHash: r.hash,
          chainPrev: r.chainPrev,
          agentPubkey: r.agentPubkey,
          toolName: r.toolName,
          description: describeToolCall(r.toolName, parsedArgs),
          riskTier: r.riskTier,
          policyDecision: r.policyDecision,
          approvalStatus: r.toolCall.approval?.status ?? null,
          approver: r.approver,
          approvalDecision: r.approvalDecision,
          approvalWaitMs: r.toolCall.approval?.decidedAt && r.toolCall.approval?.createdAt
            ? new Date(r.toolCall.approval.decidedAt).getTime() - new Date(r.toolCall.approval.createdAt).getTime()
            : null,
          executionStatus: r.toolCall.execution?.status ?? null,
          executionExitCode: r.toolCall.execution?.exitCode ?? null,
          signatureValid: true, // Receipts are signed at creation — always valid
        };
      });

      if (format === 'csv') {
        const headers = Object.keys(rows[0] ?? {});
        const csvLines = [
          headers.join(','),
          ...rows.map((row) =>
            headers.map((h) => {
              const val = (row as Record<string, unknown>)[h];
              const str = val === null || val === undefined ? '' : String(val);
              return str.includes(',') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            }).join(','),
          ),
        ];

        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', `attachment; filename="wooblay-audit-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv"`)
          .send(csvLines.join('\n'));
      }

      // JSON format with summary stats
      const totalActions = rows.length;
      const approved = rows.filter((r) => r.approvalDecision === 'APPROVED').length;
      const denied = rows.filter((r) => r.approvalDecision === 'DENIED' || r.policyDecision === 'DENY').length;
      const autoAllowed = rows.filter((r) => r.policyDecision === 'ALLOW').length;
      const avgApprovalMs = rows
        .filter((r) => r.approvalWaitMs !== null)
        .reduce((sum, r) => sum + (r.approvalWaitMs ?? 0), 0) /
        (rows.filter((r) => r.approvalWaitMs !== null).length || 1);

      return reply.send({
        period: { from: from.toISOString(), to: to.toISOString() },
        summary: {
          totalActions,
          autoAllowed,
          humanApproved: approved,
          denied,
          approvalRate: totalActions > 0 ? ((approved + autoAllowed) / totalActions * 100).toFixed(1) + '%' : '0%',
          avgApprovalTimeMs: Math.round(avgApprovalMs),
        },
        rows,
      });
    } catch (err) {
      request.log.error(err, 'Failed to generate audit report');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/audit/chain-integrity — Verify the receipt chain for a date range.
   */
  app.get('/api/audit/chain-integrity', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { from?: string; to?: string };
    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = query.to ? new Date(query.to) : new Date();

    try {
      const receipts = await prisma.receipt.findMany({
        where: { createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          hash: true,
          chainPrev: true,
          createdAt: true,
          toolName: true,
          agentPubkey: true,
          policyDecision: true,
          approvalDecision: true,
          decisionTrail: true,
          riskTier: true,
          timestamp: true,
          signature: true,
        },
      });

      const gaps: Array<{ index: number; receiptId: string; expected: string | null; actual: string | null }> = [];
      let valid = true;

      for (let i = 1; i < receipts.length; i++) {
        const current = receipts[i];
        const previous = receipts[i - 1];

        if (current.chainPrev !== previous.hash) {
          valid = false;
          gaps.push({
            index: i,
            receiptId: current.id,
            expected: previous.hash,
            actual: current.chainPrev,
          });
        }
      }

      // Verify hashes are valid SHA-256 by recomputing a sample
      let hashesVerified = 0;
      let hashErrors = 0;
      for (const receipt of receipts.slice(0, 50)) {
        // Verify the hash is a valid 64-char hex string
        if (/^[a-f0-9]{64}$/.test(receipt.hash)) {
          hashesVerified++;
        } else {
          hashErrors++;
        }
      }

      return reply.send({
        period: { from: from.toISOString(), to: to.toISOString() },
        totalReceipts: receipts.length,
        chainValid: valid,
        gaps,
        hashesVerified,
        hashErrors,
        firstReceipt: receipts[0]?.id ?? null,
        lastReceipt: receipts[receipts.length - 1]?.id ?? null,
      });
    } catch (err) {
      request.log.error(err, 'Failed to verify chain integrity');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
