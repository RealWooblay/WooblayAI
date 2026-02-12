/**
 * Receipt builder.
 *
 * Creates a cryptographically signed, hash-chained receipt for every tool call
 * decision. Receipts form an append-only ledger that can be independently
 * verified.
 */

import type { PrismaClient } from '@prisma/client';
import type { DecisionTrail, ExecutionSummary } from '@wooblay/types';
import { hashReceipt, signReceipt } from '@wooblay/crypto';
import { config } from '../config.js';
import { persistEvent } from '../events/bus.js';

export interface CreateReceiptInput {
  toolCallId: string;
  agentPubkey: string;
  toolName: string;
  riskTier: string;
  policyDecision: string;
  policyRuleId?: string | null;
  approvalDecision?: string | null;
  approver?: string | null;
  executionSummary?: ExecutionSummary | null;
  decisionTrail: DecisionTrail;
}

/**
 * Build, sign, and persist a receipt inside a serializable transaction.
 *
 * The receipt's `id` is its content hash, making the ledger content-addressable.
 * Each receipt links to the previous one via `chainPrev`, forming a hash chain.
 */
export async function createReceipt(
  prisma: PrismaClient,
  data: CreateReceiptInput,
): Promise<{ id: string; hash: string }> {
  return prisma.$transaction(
    async (tx) => {
      // Get the previous receipt hash to form the chain link
      const lastReceipt = await tx.receipt.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { hash: true },
      });

      const chainPrev = lastReceipt?.hash ?? null;
      const timestamp = new Date().toISOString();

      // Build the receipt body (everything except id, hash, signature, createdAt)
      const body = {
        toolCallId: data.toolCallId,
        agentPubkey: data.agentPubkey,
        toolName: data.toolName,
        riskTier: data.riskTier,
        policyDecision: data.policyDecision,
        policyRuleId: data.policyRuleId ?? null,
        approvalDecision: data.approvalDecision ?? null,
        approver: data.approver ?? null,
        executionSummary: data.executionSummary ?? null,
        decisionTrail: data.decisionTrail,
        chainPrev,
        timestamp,
      };

      // Compute content-addressable hash
      const hash = hashReceipt(body);

      // Sign the hash with the server private key
      const signature = signReceipt(hash, config.WOOBLAY_SERVER_PRIVATE_KEY);

      // Persist the receipt (id = hash for content-addressability)
      const receipt = await tx.receipt.create({
        data: {
          id: hash,
          toolCallId: data.toolCallId,
          agentPubkey: data.agentPubkey,
          toolName: data.toolName,
          riskTier: data.riskTier,
          policyDecision: data.policyDecision,
          policyRuleId: data.policyRuleId ?? null,
          approvalDecision: data.approvalDecision ?? null,
          approver: data.approver ?? null,
          executionSummary: data.executionSummary
            ? JSON.stringify(data.executionSummary)
            : null,
          decisionTrail: JSON.stringify(data.decisionTrail),
          chainPrev,
          timestamp,
          hash,
          signature,
        },
      });

      // Emit the receipt.created event (persisted outside the transaction)
      await persistEvent(prisma, {
        type: 'receipt.created',
        data: { receiptId: receipt.id, toolCallId: data.toolCallId },
      });

      return { id: receipt.id, hash: receipt.hash };
    },
    { isolationLevel: 'Serializable' },
  );
}
