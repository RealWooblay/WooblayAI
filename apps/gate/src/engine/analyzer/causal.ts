/**
 * Causal Chain Reconstruction
 *
 * Links findings and flagged receipts into directed attack narrative graphs.
 * Turns isolated anomalies into coherent stories.
 */

import type { Finding, CausalChainNode, CausalVerdict } from '@wooblay/types';
import type { CollectedReceipt, CollectedToolCall, DetectorContext } from './collector.js';
import { describeToolCall } from '../analysis.js';

/** Time window for considering receipts as potentially causally linked. */
const CHAIN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Minimum findings to attempt chain construction. */
const MIN_FINDINGS_FOR_CHAIN = 2;

/**
 * Build a causal chain from a set of findings and their evidence receipts.
 * Returns null if no meaningful chain can be constructed.
 */
export function buildCausalChain(
  ctx: DetectorContext,
  findings: Finding[],
): CausalChainNode[] | null {
  if (findings.length < MIN_FINDINGS_FOR_CHAIN) return null;

  // Collect all evidence receipt IDs and tool call IDs
  const evidenceIds = new Set<string>();
  for (const f of findings) {
    for (const ref of f.evidenceRefs) {
      evidenceIds.add(ref);
    }
  }

  if (evidenceIds.size === 0) return null;

  // Map receipts and tool calls by ID for quick lookup
  const receiptMap = new Map(ctx.receipts.map((r) => [r.id, r]));
  const receiptByHash = new Map(ctx.receipts.map((r) => [r.hash, r]));
  const toolCallMap = new Map(ctx.toolCalls.map((tc) => [tc.id, tc]));

  // Build nodes from evidence
  const nodes: CausalChainNode[] = [];
  const processedIds = new Set<string>();

  // Sort evidence by timestamp
  const evidenceReceipts: CollectedReceipt[] = [];
  const evidenceToolCalls: CollectedToolCall[] = [];

  for (const id of evidenceIds) {
    const receipt = receiptMap.get(id) ?? receiptByHash.get(id);
    if (receipt && !processedIds.has(receipt.id)) {
      evidenceReceipts.push(receipt);
      processedIds.add(receipt.id);
    }

    const tc = toolCallMap.get(id);
    if (tc && !processedIds.has(tc.id)) {
      // Find the receipt for this tool call
      const tcReceipt = ctx.receipts.find((r) => r.toolCallId === tc.id);
      if (tcReceipt && !processedIds.has(tcReceipt.id)) {
        evidenceReceipts.push(tcReceipt);
        processedIds.add(tcReceipt.id);
      }
      evidenceToolCalls.push(tc);
    }
  }

  // Sort by timestamp
  evidenceReceipts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (evidenceReceipts.length < 2) return null;

  // Build chain nodes
  for (let i = 0; i < evidenceReceipts.length; i++) {
    const receipt = evidenceReceipts[i];
    const tc = toolCallMap.get(receipt.toolCallId);

    let action = receipt.toolName;
    if (tc) {
      action = describeToolCall(tc.toolName, tc.parsedArgs);
    }

    // Determine verdict based on findings that reference this receipt
    const relatedFindings = findings.filter(
      (f) => f.evidenceRefs.includes(receipt.id) || f.evidenceRefs.includes(receipt.hash) || f.evidenceRefs.includes(receipt.toolCallId),
    );

    let verdict: CausalVerdict = 'benign';
    if (relatedFindings.some((f) => f.confidence >= 0.8)) {
      verdict = 'malicious';
    } else if (relatedFindings.length > 0) {
      verdict = 'suspicious';
    }

    // Link to next node(s) in the chain
    const linksTo: string[] = [];
    for (let j = i + 1; j < evidenceReceipts.length; j++) {
      const next = evidenceReceipts[j];
      const timeDiff = new Date(next.timestamp).getTime() - new Date(receipt.timestamp).getTime();

      if (timeDiff <= CHAIN_WINDOW_MS) {
        // Check if causally related
        if (isCausallyRelated(receipt, next, ctx)) {
          linksTo.push(next.hash);
        }
      } else {
        break; // outside window
      }
    }

    nodes.push({
      receiptHash: receipt.hash,
      toolCallId: receipt.toolCallId,
      action,
      timestamp: receipt.timestamp,
      verdict,
      linksTo,
    });
  }

  // Only return chain if there are actual links
  const hasLinks = nodes.some((n) => n.linksTo.length > 0);
  return hasLinks ? nodes : null;
}

/**
 * Determine if two receipts are causally related.
 */
function isCausallyRelated(
  a: CollectedReceipt,
  b: CollectedReceipt,
  ctx: DetectorContext,
): boolean {
  // Same tool with mutated args (evasion chain)
  if (a.toolName === b.toolName && a.policyDecision === 'DENY') {
    return true;
  }

  // DENY followed by similar ALLOW (bypass chain)
  if (a.policyDecision === 'DENY' && b.policyDecision === 'ALLOW' && a.toolName === b.toolName) {
    return true;
  }

  // READ of sensitive data followed by WRITE to external (exfiltration chain)
  const tcA = ctx.toolCalls.find((tc) => tc.id === a.toolCallId);
  const tcB = ctx.toolCalls.find((tc) => tc.id === b.toolCallId);

  if (tcA && tcB) {
    const cmdA = String(tcA.parsedArgs['command'] ?? '');
    const urlB = String(tcB.parsedArgs['url'] ?? '');

    // Read followed by HTTP/curl
    if (a.riskTier === 'READ' && (b.riskTier === 'WRITE' || b.riskTier === 'DESTRUCTIVE')) {
      if (tcB.toolName === 'wooblay_http' || cmdA.includes('cat ') || cmdA.includes('read ')) {
        return true;
      }
    }
  }

  // Parent/child delegation chain
  if (a.agentPubkey !== b.agentPubkey) {
    // Different agents, same tool = potential delegation
    if (a.toolName === b.toolName) return true;
  }

  // Chain via receipt links
  if (b.chainPrev === a.hash) return true;

  return false;
}
