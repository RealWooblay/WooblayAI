/**
 * Rate limiting middleware.
 *
 * Per-IP sliding window rate limiter for API routes.
 * In-memory for MVP; swap to Redis for production.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60s
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 60_000);

// ── Config ──────────────────────────────────────────────────────────────

const LIMITS: Record<string, { max: number; windowMs: number }> = {
  // Auth endpoints: aggressive rate limiting
  'POST:/api/coupons/redeem': { max: 5, windowMs: 60_000 },
  'POST:/api/webhooks/github': { max: 100, windowMs: 60_000 },
  // Gateway: moderate
  'POST:/api/gateway/execute': { max: 60, windowMs: 60_000 },
  // Default for all API routes
  default: { max: 200, windowMs: 60_000 },
};

// ── Plugin ──────────────────────────────────────────────────────────────

export const rateLimitPlugin = fp(async function rateLimitPluginInner(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method === 'OPTIONS') return;
    if (!request.url.startsWith('/api/')) return;

    const ip = request.ip || request.headers['x-forwarded-for']?.toString() || 'unknown';
    const path = request.url.split('?')[0]!;
    const routeKey = `${request.method}:${path}`;

    const config = LIMITS[routeKey] ?? LIMITS.default!;
    const storeKey = `${ip}:${routeKey}`;
    const now = Date.now();

    let entry = store.get(storeKey);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + config.windowMs };
      store.set(storeKey, entry);
    }

    entry.count++;

    // Set headers
    reply.header('X-RateLimit-Limit', String(config.max));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, config.max - entry.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > config.max) {
      return reply.code(429).send({
        error: 'Too many requests',
        retryAfterMs: entry.resetAt - now,
      });
    }
  });
});
