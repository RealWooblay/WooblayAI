/**
 * Clerk authentication middleware for platform mode.
 *
 * When PLATFORM_MODE=true, uses @clerk/fastify's clerkPlugin and getAuth
 * to verify JWTs and attach the Clerk userId to the request.
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

  // Register the official Clerk Fastify plugin (decorates request with auth)
  const { clerkPlugin, getAuth } = await import('@clerk/fastify');
  await app.register(clerkPlugin);

  // After Clerk plugin runs, extract userId and enforce auth
  app.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'OPTIONS') return;
      if (isPublic(request.url)) return;
      // Allow agent-auth'd requests (from instance Gates)
      if (request.headers['x-agent-pubkey']) return;

      try {
        const auth = getAuth(request);
        if (!auth.userId) {
          return reply.code(401).send({ error: 'Not authenticated' });
        }
        request.clerkUserId = auth.userId;
      } catch {
        return reply.code(401).send({ error: 'Authentication failed' });
      }
    },
  );
}
