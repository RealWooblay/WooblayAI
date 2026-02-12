/**
 * Clerk authentication middleware for platform mode.
 *
 * Verifies Clerk JWTs from the Authorization header (Bearer token)
 * and attaches the Clerk userId to the request.
 *
 * When PLATFORM_MODE=false (instance mode), this middleware is a no-op.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

// Augment Fastify's request type
declare module 'fastify' {
  interface FastifyRequest {
    clerkUserId?: string;
  }
}

/** Routes that never require user auth (regardless of mode). */
const PUBLIC_PATHS = [
  '/health',
  '/api/webhooks/clerk',
  '/api/tool/execute',
  '/api/sync/events',
];

function isPublic(url: string): boolean {
  const path = url.split('?')[0];
  return PUBLIC_PATHS.some((p) => path === p || path === p + '/');
}

export async function clerkAuthPlugin(app: FastifyInstance): Promise<void> {
  if (!config.PLATFORM_MODE) return;
  if (!config.CLERK_SECRET_KEY) {
    app.log.warn('PLATFORM_MODE=true but no CLERK_SECRET_KEY — auth disabled');
    return;
  }

  // Use @clerk/backend's standalone verifyToken (more reliable than the Fastify plugin)
  const { verifyToken } = await import('@clerk/backend');

  app.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'OPTIONS') return;
      if (isPublic(request.url)) return;
      // Allow agent-auth'd requests (from instance Gates)
      if (request.headers['x-agent-pubkey']) return;
      // Allow static file requests
      if (!request.url.startsWith('/api/')) return;

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Missing authorization token' });
      }

      const token = authHeader.slice(7);

      try {
        const payload = await verifyToken(token, {
          secretKey: config.CLERK_SECRET_KEY,
        });
        if (!payload.sub) {
          return reply.code(401).send({ error: 'Invalid token — no subject' });
        }
        request.clerkUserId = payload.sub;
      } catch (err) {
        request.log.warn({ err }, 'Clerk token verification failed');
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }
    },
  );
}
