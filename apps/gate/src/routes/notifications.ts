/**
 * Notification action routes.
 *
 * Handles one-click approve/deny from notification links (Telegram, Slack,
 * WhatsApp, email). Security model:
 *
 *   GET  /api/notifications/action/:token  → confirmation page (safe for bots)
 *   POST /api/notifications/action/:token  → actually resolves the approval
 *
 * The GET/POST split prevents link-preview bots (Telegram, Slack, email
 * scanners like Microsoft Safe Links) from accidentally triggering approvals.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ApprovalStatus } from '@wooblay/types';
import { prisma } from '../db/client.js';
import { resolveApprovalAtomic } from '../services/approval.js';
import { createReceipt } from '../engine/receipt.js';

export async function notificationRoutes(app: FastifyInstance) {
  /**
   * GET — render a mobile-friendly confirmation page.
   * Link preview bots only do GET, so they see this page but never execute.
   */
  app.get(
    '/api/notifications/action/:token',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };

      const action = await prisma.notificationAction.findUnique({ where: { token } });

      if (!action || action.expiresAt < new Date()) {
        return reply.code(410).type('text/html').send(expiredHtml());
      }

      if (action.used) {
        return reply.type('text/html').send(alreadyUsedHtml());
      }

      const approval = await prisma.approval.findUnique({
        where: { id: action.approvalId },
        include: { toolCall: true },
      });

      if (!approval || approval.status !== 'PENDING') {
        return reply.type('text/html').send(alreadyUsedHtml());
      }

      let argsPreview = '';
      try {
        const parsed = JSON.parse(approval.toolCall.args);
        argsPreview = JSON.stringify(parsed, null, 2).slice(0, 400);
      } catch {
        argsPreview = approval.toolCall.args.slice(0, 400);
      }

      return reply.type('text/html').send(
        confirmationHtml(
          action.decision,
          approval.toolCall.toolName,
          approval.toolCall.riskTier,
          argsPreview,
          token,
        ),
      );
    },
  );

  /**
   * POST — actually resolve the approval. Only triggered by the human
   * clicking the button on the confirmation page.
   */
  app.post(
    '/api/notifications/action/:token',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { token } = request.params as { token: string };

      const action = await prisma.notificationAction.findUnique({ where: { token } });

      if (!action || action.expiresAt < new Date()) {
        return reply.code(410).type('text/html').send(expiredHtml());
      }

      if (action.used) {
        return reply.type('text/html').send(alreadyUsedHtml());
      }

      try {
        const approval = await prisma.approval.findUnique({
          where: { id: action.approvalId },
          include: { toolCall: true },
        });

        if (!approval || approval.status !== 'PENDING') {
          return reply.type('text/html').send(alreadyUsedHtml());
        }

        if (approval.requiredApproverRole) {
          const approverUserId = action.approver;
          let approverRole: string | null = null;

          if (approverUserId && approverUserId !== 'notification') {
            const user = await prisma.user.findUnique({
              where: { id: approverUserId },
              select: { role: true },
            });
            approverRole = user?.role ?? null;
          }

          const normalized = (approverRole ?? '').replace(/^org:/, '');
          if (normalized !== approval.requiredApproverRole && normalized !== 'admin' && normalized !== 'owner') {
            return reply.code(403).type('text/html').send(
              wrapHtml(
                'Insufficient Role',
                `This action requires approval from a user with role: <strong>${escapeHtml(approval.requiredApproverRole)}</strong>. Your role does not match.`,
              ),
            );
          }
        }

        // S5: Atomic resolve — only succeeds if status is still PENDING
        const status: ApprovalStatus = action.decision === 'approve' ? 'APPROVED' : 'DENIED';
        const resolved = await resolveApprovalAtomic(
          prisma,
          action.approvalId,
          status,
          action.approver,
          'Via notification link',
        );

        if (!resolved) {
          return reply.type('text/html').send(alreadyUsedHtml());
        }

        // Mark token as used
        await prisma.notificationAction.update({
          where: { id: action.id },
          data: { used: true },
        });

        // S4: Create cryptographic receipt for audit trail
        await createReceipt(prisma, {
          toolCallId: approval.toolCallId,
          agentPubkey: approval.toolCall.agentPubkey,
          toolName: approval.toolCall.toolName,
          riskTier: approval.toolCall.riskTier,
          policyDecision: 'APPROVE',
          approvalDecision: status,
          approver: action.approver,
          decisionTrail: {
            plan_summary: `Human ${action.decision === 'approve' ? 'approved' : 'denied'} via notification link`,
            reason_summary: 'Decision via notification action link',
            inputs_used: [],
            citations: [],
          },
        });

        return reply.type('text/html').send(successHtml(action.decision === 'approve'));
      } catch (err: any) {
        request.log.error(err, 'Failed to resolve notification action');
        return reply.code(500).type('text/html').send(errorHtml(err.message));
      }
    },
  );
}

// ── HTML Templates ───────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function confirmationHtml(
  decision: string,
  toolName: string,
  riskTier: string,
  argsPreview: string,
  token: string,
): string {
  const isApprove = decision === 'approve';
  const actionLabel = isApprove ? 'Approve' : 'Deny';
  const actionColor = isApprove ? '#22c55e' : '#ef4444';
  const riskColor = riskTier === 'DESTRUCTIVE' ? '#ef4444' : riskTier === 'WRITE' ? '#f59e0b' : '#3b82f6';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wooblay — Confirm ${actionLabel}</title></head>
<body style="margin:0;padding:16px;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a1a;font-family:system-ui,sans-serif;">
<div style="max-width:440px;width:100%;padding:28px;background:#1a1a2e;border-radius:16px;border:1px solid #333;">
  <div style="text-align:center;margin-bottom:20px;">
    <h1 style="color:#818cf8;font-size:18px;margin:0 0 4px;">Wooblay</h1>
    <p style="color:#666;font-size:11px;margin:0;">Agent action requires your decision</p>
  </div>

  <div style="background:#0f0f1f;border:1px solid #2a2a3e;border-radius:10px;padding:16px;margin-bottom:16px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="background:${riskColor}22;color:${riskColor};padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;">${escapeHtml(riskTier)}</span>
      <span style="color:#a0a0b0;font-size:12px;font-family:monospace;">${escapeHtml(toolName)}</span>
    </div>
    <pre style="color:#888;font-size:11px;font-family:monospace;white-space:pre-wrap;word-break:break-all;margin:0;max-height:200px;overflow:auto;">${escapeHtml(argsPreview)}</pre>
  </div>

  <form method="POST" action="/api/notifications/action/${escapeHtml(token)}">
    <button type="submit" style="width:100%;padding:12px;border:none;border-radius:10px;background:${actionColor};color:#fff;font-size:15px;font-weight:600;cursor:pointer;">
      ${actionLabel} This Action
    </button>
  </form>

  <p style="color:#555;font-size:11px;text-align:center;margin-top:16px;">
    This link is single-use and expires in 24 hours.<br>
    Only click if you intend to ${decision} this action.
  </p>
</div></body></html>`;
}

function expiredHtml(): string {
  return wrapHtml('Link Expired', 'This notification link has expired or is invalid. Check the Wooblay dashboard.');
}

function alreadyUsedHtml(): string {
  return wrapHtml('Already Processed', 'This action has already been processed.');
}

function successHtml(approved: boolean): string {
  const action = approved ? 'Approved' : 'Denied';
  const color = approved ? '#22c55e' : '#ef4444';
  return wrapHtml(
    `Action ${action}`,
    `The action has been <span style="color:${color};font-weight:600;">${action.toLowerCase()}</span>. You can close this page.`,
  );
}

function errorHtml(message: string): string {
  return wrapHtml('Error', `Something went wrong: ${escapeHtml(message)}`);
}

function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Wooblay — ${escapeHtml(title)}</title></head>
<body style="margin:0;padding:16px;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a1a;font-family:system-ui,sans-serif;">
<div style="max-width:400px;padding:32px;background:#1a1a2e;border-radius:16px;border:1px solid #333;text-align:center;">
<h1 style="color:#818cf8;font-size:20px;margin:0 0 12px;">${title}</h1>
<p style="color:#a0a0b0;font-size:14px;line-height:1.6;margin:0;">${body}</p>
<p style="color:#555;font-size:11px;margin-top:24px;">Wooblay</p>
</div></body></html>`;
}
