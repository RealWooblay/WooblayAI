import { createHash } from 'node:crypto';
import { canonicalJson } from './canonical.js';
import { sign, verify } from './signing.js';
import type { Receipt } from '@wooblay/types';

/**
 * Fields of a receipt used for hashing (everything except id, hash, signature).
 */
function receiptBody(r: Omit<Receipt, 'id' | 'hash' | 'signature' | 'createdAt'>): unknown {
  return {
    toolCallId: r.toolCallId,
    agentPubkey: r.agentPubkey,
    toolName: r.toolName,
    riskTier: r.riskTier,
    policyDecision: r.policyDecision,
    policyRuleId: r.policyRuleId,
    approvalDecision: r.approvalDecision,
    approver: r.approver,
    executionSummary: r.executionSummary,
    decisionTrail: r.decisionTrail,
    chainPrev: r.chainPrev,
    timestamp: r.timestamp,
  };
}

/**
 * Compute SHA-256 hash of a receipt body (content-addressable).
 */
export function hashReceipt(body: Omit<Receipt, 'id' | 'hash' | 'signature' | 'createdAt'>): string {
  const canonical = canonicalJson(receiptBody(body));
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Sign a receipt hash with the server private key.
 */
export function signReceipt(hash: string, serverPrivateKeyHex: string): string {
  return sign(hash, serverPrivateKeyHex);
}

/**
 * Verify a receipt's signature using the server public key.
 */
export function verifyReceipt(receipt: Receipt, serverPublicKeyHex: string): boolean {
  // Verify the hash matches the content
  const expectedHash = hashReceipt(receipt);
  if (expectedHash !== receipt.hash) return false;

  // Verify the signature over the hash
  return verify(receipt.hash, receipt.signature, serverPublicKeyHex);
}

/**
 * Verify an ordered chain of receipts.
 * Each receipt's chainPrev must match the hash of the previous receipt.
 */
export function verifyChain(receipts: Receipt[], serverPublicKeyHex: string): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < receipts.length; i++) {
    const r = receipts[i]!;

    // Verify individual receipt
    if (!verifyReceipt(r, serverPublicKeyHex)) {
      return { valid: false, brokenAt: i };
    }

    // Verify chain link
    if (i === 0) {
      // First receipt in the segment — chainPrev can point to an earlier receipt
      continue;
    }
    const prev = receipts[i - 1]!;
    if (r.chainPrev !== prev.hash) {
      return { valid: false, brokenAt: i };
    }
  }

  return { valid: true };
}
