/**
 * HUMAN_INTERVENTION Detector (Layer 0)
 *
 * Detects when human approver activity appears in the receipt chain.
 * Placeholder: will be enriched when GitHub agent signal is available.
 */

import type { Finding } from '@wooblay/types';
import type { Detector } from '../detector.js';
import type { DetectorContext } from '../collector.js';

export const humanInterventionDetector: Detector = {
  code: 'HUMAN_INTERVENTION',

  detect(ctx: DetectorContext): Finding[] {
    const findings: Finding[] = [];
    const now = new Date().toISOString();

    // Detect human approvals in the receipt chain
    const humanApprovals = ctx.approvals.filter(
      (a) => a.status === 'APPROVED' && a.approver,
    );

    if (humanApprovals.length > 0) {
      const approvers = [...new Set(humanApprovals.map((a) => a.approver).filter(Boolean))];
      findings.push({
        code: 'HUMAN_INTERVENTION',
        message: `Human intervention detected: ${humanApprovals.length} approval(s) by ${approvers.join(', ')}`,
        evidenceRefs: humanApprovals.map((a) => a.toolCallId),
        confidence: 1.0,
        suggestedAction: 'info-only',
        detectedAt: now,
      });
    }

    // Also detect human denials (potentially more interesting)
    const humanDenials = ctx.approvals.filter(
      (a) => a.status === 'DENIED' && a.approver,
    );

    if (humanDenials.length > 0) {
      const approvers = [...new Set(humanDenials.map((a) => a.approver).filter(Boolean))];
      findings.push({
        code: 'HUMAN_INTERVENTION',
        message: `Human denial: ${humanDenials.length} action(s) denied by ${approvers.join(', ')}`,
        evidenceRefs: humanDenials.map((a) => a.toolCallId),
        confidence: 1.0,
        suggestedAction: 'info-only',
        detectedAt: now,
      });
    }

    return findings;
  },
};
