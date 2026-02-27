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
import fp from 'fastify-plugin';
import cookie from '@fastify/cookie';
import { config } from '../config.js';
import { prisma } from '../db/client.js';
import { recordAuthSuccess, recordAuthFailure, extractIp, extractUserAgent } from './auth-audit.js';

// Augment Fastify's request type
declare module 'fastify' {
  interface FastifyRequest {
    clerkUserId?: string;
    /** Populated by Clerk Organizations — org ID + role from the JWT claims. */
    user?: {
      clerkId: string;
      orgId: string | null;
      role: string;
    };
  }
}

/** Routes that never require user auth (regardless of mode). */
const PUBLIC_PATHS = [
  '/health',
  '/api/webhooks/clerk',
  '/api/tool/execute',
  '/api/tool/structured-execute',
  '/api/sync/events',
  '/api/gateway/execute',
  '/api/gateway/capabilities',
  '/api/gateway/spec',
  '/api/gateway/bypass-report',
];

/** Route prefixes that never require user auth (e.g. external webhooks). */
const PUBLIC_PREFIXES = [
  '/api/webhooks/github/',
  '/view/',
  '/api/notifications/action/',
];

function isPublic(url: string): boolean {
  const path = url.split('?')[0];
  if (PUBLIC_PATHS.some((p) => path === p || path === p + '/')) return true;
  if (PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;
  return false;
}

// Use fp() so hooks apply globally, not just inside this encapsulated plugin
export const clerkAuthPlugin = fp(async function clerkAuthPluginInner(app: FastifyInstance): Promise<void> {
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

      // Skip Clerk auth for internal Docker network requests (agent → gate).
      // These come from managed containers on the 172.x.x.x network, not the internet.
      const host = request.headers.host ?? '';
      if (host.startsWith('172.') || host.startsWith('10.') || host === 'localhost:4800') return;

      // Skip Wooblay API key tokens — handled by apiKeyAuthPlugin.
      // Without this, Clerk would try to verify wbl_ak_ as a JWT and reject it.
      if (request.headers.authorization?.startsWith('Bearer wbl_ak_')) return;

      // Try Bearer token first (API clients), then __session cookie (browser)
      let token: string | undefined;

      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.slice(7);
      }

      if (!token) {
        // Clerk v5 (Core 2) sets a __session cookie; older versions may use __clerk_db_jwt
        const cookies = request.cookies;
        if (cookies?.['__session']) {
          token = cookies['__session'];
        } else if (cookies?.['__clerk_db_jwt']) {
          token = cookies['__clerk_db_jwt'];
        }
      }

      if (!token) {
        await recordAuthFailure(prisma, {
          action: 'auth_failure',
          detail: 'No token found in request',
          ipAddress: extractIp(request),
          userAgent: extractUserAgent(request),
        });
        return reply.code(401).send({ error: 'Not authenticated' });
      }

      try {
        const payload = await verifyToken(token, {
          secretKey: config.CLERK_SECRET_KEY,
        });
        if (!payload.sub) {
          await recordAuthFailure(prisma, {
            action: 'auth_failure',
            detail: 'Token has no sub claim',
            ipAddress: extractIp(request),
            userAgent: extractUserAgent(request),
          });
          return reply.code(401).send({ error: 'Invalid token' });
        }
        request.clerkUserId = payload.sub;

        // Extract Clerk Organizations claims from the JWT.
        // When a user has an active org, the token contains org_id + org_role.
        // This feeds into org-scope.ts for multi-tenant query isolation.
        const orgId = (payload as any).org_id as string | undefined;
        const orgRole = (payload as any).org_role as string | undefined;
        request.user = {
          clerkId: payload.sub,
          orgId: orgId ?? null,
          role: orgRole ?? 'member',
        };

        // Record successful auth (only for non-trivial routes)
        if (!request.url.includes('/health')) {
          await recordAuthSuccess(prisma, {
            userId: payload.sub,
            action: 'login',
            sessionId: (payload as any).sid,
            ipAddress: extractIp(request),
            userAgent: extractUserAgent(request),
          });
        }
      } catch (err) {
        request.log.warn({ err }, 'Clerk token verification failed');
        await recordAuthFailure(prisma, {
          action: 'auth_failure',
          detail: `Token verification failed: ${(err as Error).message}`,
          ipAddress: extractIp(request),
          userAgent: extractUserAgent(request),
        });
        return reply.code(401).send({ error: 'Invalid or expired token' });
      }
    },
  );
});
