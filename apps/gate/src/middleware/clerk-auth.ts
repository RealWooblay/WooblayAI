/**
 * Clerk authentication middleware for platform mode.
 *
 * Extracts the Clerk userId from:
 *   1. Authorization: Bearer <token> header (API clients)
 *   2. __session cookie (browser requests — set by Clerk's frontend SDK)
 *
 * When PLATFORM_MODE=false (instance mode), this middleware is a no-op.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
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

  // Register cookie parser so we can read __session
  await app.register(cookie);

  const { verifyToken } = await import('@clerk/backend');

  app.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'OPTIONS') return;
      if (isPublic(request.url)) return;
      if (request.headers['x-agent-pubkey']) return;
      if (!request.url.startsWith('/api/')) return;

      // Try Bearer token first (API clients), then __session cookie (browser)
      let token: string | undefined;

      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }

      if (!token) {
        // Clerk sets a __session cookie in the browser
        const cookies = request.cookies;
        if (cookies?.['__session']) {
          token = cookies['__session'];
        }
      }

      // Debug: log what we received (remove after fixing)
      if (!token) {
        const cookieHeader = request.headers.cookie ?? '(none)';
        const cookieNames = cookieHeader !== '(none)'
          ? cookieHeader.split(';').map((c: string) => c.trim().split('=')[0]).join(', ')
          : '(none)';
        request.log.info({
          url: request.url,
          hasAuth: !!request.headers.authorization,
          cookieNames,
          parsedCookies: Object.keys(request.cookies ?? {}),
        }, 'Auth debug: no token found');
      }

      if (!token) {
        return reply.code(401).send({ error: 'Not authenticated' });
      }

      try {
        const payload = await verifyToken(token, {
          secretKey: config.CLERK_SECRET_KEY,
        });
        if (!payload.sub) {
          return reply.code(401).send({ error: 'Invalid token' });
        }
        request.clerkUserId = payload.sub;
      } catch (err) {
        request.log.warn({ err }, 'Clerk token verification failed');
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }
    },
  );
}
