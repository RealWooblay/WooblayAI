/**
 * GitHub Webhook Signature Verification.
 *
 * Validates the X-Hub-Signature-256 header using HMAC-SHA256.
 * Rejects unsigned or invalid payloads before they reach sensor processing.
 *
 * The webhook secret is stored in GITHUB_WEBHOOK_SECRET env var.
 * If not set, verification is skipped in development mode only.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

/**
 * Verify GitHub webhook signature.
 * Call this as the first step in the webhook handler.
 */
export function verifyGitHubWebhookSignature(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const secret = config.GITHUB_WEBHOOK_SECRET;

  // In development without a secret, log warning and allow
  if (!secret) {
    if (config.NODE_ENV === 'production') {
      reply.code(500).send({ error: 'Webhook secret not configured' });
      return false;
    }
    request.log.warn('GITHUB_WEBHOOK_SECRET not set — skipping webhook signature verification');
    return true;
  }

  const signatureHeader = request.headers['x-hub-signature-256'] as string | undefined;

  if (!signatureHeader) {
    request.log.warn('Missing X-Hub-Signature-256 header on GitHub webhook');
    reply.code(401).send({ error: 'Missing webhook signature' });
    return false;
  }

  // Compute expected HMAC
  const rawBody = typeof request.body === 'string'
    ? request.body
    : JSON.stringify(request.body);

  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Timing-safe comparison to prevent timing attacks
  const sigBuffer = Buffer.from(signatureHeader, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    request.log.warn({ received: signatureHeader.slice(0, 20) }, 'Invalid GitHub webhook signature');
    reply.code(401).send({ error: 'Invalid webhook signature' });
    return false;
  }

  return true;
}
