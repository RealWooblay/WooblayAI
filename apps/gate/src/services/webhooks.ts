/**
 * Webhook notification service.
 *
 * Fires webhooks for critical events:
 *   - approval.pending — new approval waiting
 *   - approval.stale — approval pending >15 minutes
 *   - flag.critical — CRITICAL severity flag raised
 *   - flag.high — HIGH severity flag raised
 *   - agent.trust_low — trust score drops below 40
 *
 * Non-blocking, fire-and-forget with 5s timeout.
 */

import type { PrismaClient } from '@prisma/client';

export type WebhookEventType =
  | 'approval.pending'
  | 'approval.stale'
  | 'flag.critical'
  | 'flag.high'
  | 'agent.trust_low';

interface WebhookPayload {
  event: WebhookEventType;
  instanceName?: string;
  description: string;
  dashboardLink?: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

/**
 * Fire webhooks for a given event.
 */
export async function fireWebhook(
  prisma: PrismaClient,
  event: WebhookEventType,
  payload: Omit<WebhookPayload, 'event' | 'timestamp'>,
): Promise<void> {
  try {
    const webhooks = await prisma.webhook.findMany({
      where: { active: true },
    });

    const matchingWebhooks = webhooks.filter((wh) => {
      try {
        const events = JSON.parse(wh.events) as string[];
        return events.includes(event) || events.includes('*');
      } catch {
        return false;
      }
    });

    if (matchingWebhooks.length === 0) return;

    const body: WebhookPayload = {
      event,
      ...payload,
      timestamp: new Date().toISOString(),
    };

    // Fire-and-forget with 5s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await Promise.allSettled(
      matchingWebhooks.map(async (wh) => {
        try {
          await fetch(wh.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Wooblay-Webhooks/1.0',
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } catch (err) {
          console.warn(`[webhooks] Failed to fire webhook ${wh.id}:`, err);
        }
      }),
    );

    clearTimeout(timeout);
  } catch (err) {
    console.warn('[webhooks] Error firing webhooks:', err);
  }
}
