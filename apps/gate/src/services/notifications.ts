/**
 * Multi-channel notification service.
 *
 * Delivers approval requests, anomaly alerts, and kill switch notifications
 * via Telegram, Slack, WhatsApp, and Email. Each user chooses their channels.
 * Falls back to console logging when no channel is configured.
 *
 * Env vars:
 *   TELEGRAM_BOT_TOKEN                                       — Telegram Bot API
 *   WHATSAPP_TOKEN, WHATSAPP_PHONE_ID                        — Meta WhatsApp Cloud API
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM  — Email (nodemailer)
 *   GATE_PUBLIC_URL / WOOBLAY_GATE_URL                       — base URL for action links
 *
 * Slack uses per-user incoming webhook URLs (no server-side env var needed).
 */

import type { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

/**
 * Retry a notification send with exponential backoff.
 * Only retries on transient network/server errors, not 4xx client errors.
 */
async function withRetry(fn: () => Promise<void>, label: string): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err: any) {
      const isLastAttempt = attempt === MAX_RETRIES;
      const status = err?.status ?? err?.statusCode ?? 0;
      const isClientError = status >= 400 && status < 500;

      if (isLastAttempt || isClientError) {
        console.error(`[notifications] ${label}: failed after ${attempt + 1} attempt(s):`, err);
        return;
      }

      const delay = RETRY_BASE_MS * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

export interface NotificationPayload {
  type: 'approval_needed' | 'anomaly_alert' | 'kill_switch';
  orgId: string;
  title: string;
  body: string;
  actions?: { label: string; url: string }[];
  requiredRole?: string;
}

type Channel = 'email' | 'telegram' | 'whatsapp' | 'slack';

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_FROM = process.env.SMTP_FROM ?? 'noreply@wooblay.com';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_ID;

const BASE_URL = process.env.GATE_PUBLIC_URL ?? process.env.WOOBLAY_GATE_URL ?? 'http://localhost:4800';

function isEmailConfigured(): boolean {
  return !!(SMTP_HOST && SMTP_USER && SMTP_PASS);
}
function isTelegramConfigured(): boolean {
  return !!TELEGRAM_BOT_TOKEN;
}
function isWhatsAppConfigured(): boolean {
  return !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID);
}

function parseChannels(raw: string): Channel[] {
  return raw.split(',').map((c) => c.trim().toLowerCase()).filter(
    (c): c is Channel => c === 'email' || c === 'telegram' || c === 'whatsapp' || c === 'slack',
  );
}

export async function sendNotification(
  prisma: PrismaClient,
  payload: NotificationPayload,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { orgId: payload.orgId },
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, telegramChatId: true, slackWebhookUrl: true, notifyChannels: true,
    },
  });

  let eligible = users;
  if (payload.requiredRole) {
    const required = payload.requiredRole.replace(/^org:/, '');
    eligible = users.filter((u) => {
      const role = (u.role ?? 'member').replace(/^org:/, '');
      return role === required || role === 'admin' || role === 'owner';
    });
  }

  if (eligible.length === 0) {
    eligible = users;
  }

  for (const user of eligible) {
    const channels = parseChannels(user.notifyChannels);
    let sent = false;

    for (const channel of channels) {
      switch (channel) {
        case 'email':
          if (user.email && isEmailConfigured()) {
            await withRetry(() => sendEmail(user.email!, payload), `email:${user.email}`);
            sent = true;
          }
          break;
        case 'telegram':
          if (user.telegramChatId && isTelegramConfigured()) {
            await withRetry(() => sendTelegram(user.telegramChatId!, payload), `telegram:${user.telegramChatId}`);
            sent = true;
          }
          break;
        case 'slack':
          if (user.slackWebhookUrl) {
            await withRetry(() => sendSlack(user.slackWebhookUrl!, payload), `slack:${user.id}`);
            sent = true;
          }
          break;
        case 'whatsapp':
          if (user.phone && isWhatsAppConfigured()) {
            await withRetry(() => sendWhatsApp(user.phone!, payload), `whatsapp:${user.phone}`);
            sent = true;
          }
          break;
      }
    }

    if (!sent) {
      console.log(
        `[notifications] ${payload.type} → ${user.email ?? user.id}: ${payload.title}`,
      );
      if (payload.actions?.length) {
        for (const action of payload.actions) {
          console.log(`  [${action.label}] ${action.url}`);
        }
      }
    }
  }
}

/**
 * Create a one-click notification action token (for approve/deny links).
 */
export async function createActionToken(
  prisma: PrismaClient,
  approvalId: string,
  decision: 'approve' | 'deny',
  approver: string,
): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.notificationAction.create({
    data: { token, approvalId, decision, approver, expiresAt },
  });

  return `${BASE_URL}/api/notifications/action/${token}?decision=${decision}`;
}

/**
 * Send an approval notification with per-user action links.
 * Each eligible user gets their own token pair so role enforcement
 * can verify the intended approver on the confirmation page.
 */
export async function sendApprovalNotification(
  prisma: PrismaClient,
  orgId: string,
  approvalId: string,
  toolName: string,
  riskTier: string,
  args: string,
  requiredRole?: string | null,
): Promise<void> {
  let argsPreview = '';
  try {
    const parsed = JSON.parse(args);
    argsPreview = JSON.stringify(parsed, null, 2).slice(0, 300);
  } catch {
    argsPreview = args.slice(0, 300);
  }

  const users = await prisma.user.findMany({
    where: { orgId },
    select: {
      id: true, email: true, name: true, role: true,
      phone: true, telegramChatId: true, slackWebhookUrl: true, notifyChannels: true,
    },
  });

  let eligible = users;
  if (requiredRole) {
    const required = requiredRole.replace(/^org:/, '');
    eligible = users.filter((u) => {
      const role = (u.role ?? 'member').replace(/^org:/, '');
      return role === required || role === 'admin' || role === 'owner';
    });
  }
  if (eligible.length === 0) eligible = users;

  for (const user of eligible) {
    const approveUrl = await createActionToken(prisma, approvalId, 'approve', user.id);
    const denyUrl = await createActionToken(prisma, approvalId, 'deny', user.id);

    const payload: NotificationPayload = {
      type: 'approval_needed',
      orgId,
      title: `Approval needed: ${toolName} (${riskTier})`,
      body: `An agent wants to call ${toolName}.\n\nArguments:\n${argsPreview}`,
      actions: [
        { label: 'Approve', url: approveUrl },
        { label: 'Deny', url: denyUrl },
      ],
      requiredRole: requiredRole ?? undefined,
    };

    const channels = parseChannels(user.notifyChannels);
    let sent = false;

    for (const channel of channels) {
      switch (channel) {
        case 'email':
          if (user.email && isEmailConfigured()) {
            await withRetry(() => sendEmail(user.email!, payload), `approval-email:${user.email}`);
            sent = true;
          }
          break;
        case 'telegram':
          if (user.telegramChatId && isTelegramConfigured()) {
            await withRetry(() => sendTelegram(user.telegramChatId!, payload), `approval-telegram:${user.telegramChatId}`);
            sent = true;
          }
          break;
        case 'slack':
          if (user.slackWebhookUrl) {
            await withRetry(() => sendSlack(user.slackWebhookUrl!, payload), `approval-slack:${user.id}`);
            sent = true;
          }
          break;
        case 'whatsapp':
          if (user.phone && isWhatsAppConfigured()) {
            await withRetry(() => sendWhatsApp(user.phone!, payload), `approval-whatsapp:${user.phone}`);
            sent = true;
          }
          break;
      }
    }

    if (!sent) {
      console.log(
        `[notifications] ${payload.type} → ${user.email ?? user.id}: ${payload.title}`,
      );
      if (payload.actions?.length) {
        for (const action of payload.actions) {
          console.log(`  [${action.label}] ${action.url}`);
        }
      }
    }
  }
}

// ── Email (nodemailer) ──────────────────────────────────────────────────────

async function sendEmail(to: string, payload: NotificationPayload): Promise<void> {
  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const actionHtml = payload.actions
      ?.map(
        (a) =>
          `<a href="${a.url}" style="display:inline-block;padding:10px 24px;margin:4px 8px 4px 0;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">${a.label}</a>`,
      )
      .join('') ?? '';

    await transport.sendMail({
      from: SMTP_FROM,
      to,
      subject: `Wooblay: ${payload.title}`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#1a1a2e;color:#e0e0e0;border-radius:12px;">
          <h2 style="color:#818cf8;margin:0 0 8px;">${payload.title}</h2>
          <pre style="white-space:pre-wrap;font-size:13px;color:#a0a0b0;background:#0f0f1a;padding:16px;border-radius:8px;">${payload.body}</pre>
          <div style="margin-top:16px;">${actionHtml}</div>
          <p style="font-size:11px;color:#666;margin-top:24px;">Sent by Wooblay</p>
        </div>
      `,
    });
  } catch (err) {
    console.error(`[notifications] Email failed (${to}):`, err);
  }
}

// ── Telegram Bot API ────────────────────────────────────────────────────────

async function sendTelegram(chatId: string, payload: NotificationPayload): Promise<void> {
  try {
    let text = `*${escapeMarkdown(payload.title)}*\n\n${escapeMarkdown(payload.body)}`;

    if (payload.actions?.length) {
      text += '\n';
      for (const action of payload.actions) {
        text += `\n[${escapeMarkdown(action.label)}](${action.url})`;
      }
    }

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[notifications] Telegram failed (${chatId}): ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`[notifications] Telegram failed (${chatId}):`, err);
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ── Slack Incoming Webhook ───────────────────────────────────────────────────

async function sendSlack(webhookUrl: string, payload: NotificationPayload): Promise<void> {
  try {
    const blocks: Record<string, unknown>[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: payload.title, emoji: true },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: payload.body.slice(0, 3000) },
      },
    ];

    if (payload.actions?.length) {
      blocks.push({
        type: 'actions',
        elements: payload.actions.map((a) => ({
          type: 'button',
          text: { type: 'plain_text', text: a.label },
          url: a.url,
          style: a.label.toLowerCase().includes('approve') ? 'primary' : 'danger',
        })),
      });
    }

    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: 'Sent by *Wooblay* — AI Agent Firewall' }],
    });

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`[notifications] Slack webhook failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`[notifications] Slack webhook failed:`, err);
  }
}

// ── WhatsApp Cloud API (Meta) ───────────────────────────────────────────────

async function sendWhatsApp(phone: string, payload: NotificationPayload): Promise<void> {
  try {
    let body = `*${payload.title}*\n\n${payload.body}`;

    if (payload.actions?.length) {
      body += '\n';
      for (const action of payload.actions) {
        body += `\n${action.label}: ${action.url}`;
      }
    }

    const url = `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body },
      }),
    });

    if (!res.ok) {
      const respBody = await res.text();
      console.error(`[notifications] WhatsApp failed (${phone}): ${res.status} ${respBody}`);
    }
  } catch (err) {
    console.error(`[notifications] WhatsApp failed (${phone}):`, err);
  }
}
