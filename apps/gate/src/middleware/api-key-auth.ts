/**
 * API Key authentication middleware for management routes.
 *
 * Allows external agents and the MCP proxy to authenticate with
 * API keys (wbl_ak_...) instead of Clerk JWTs on /api/* management routes
 * like /api/policies, /api/connections, /api/approvals, /api/audit.
 *
 * When a valid API key is present, sets request.user with the resolved
 * orgId so downstream code (getOrgScope, resolveOrgIdForRequest) works
 * identically to Clerk-authenticated requests.
 *
 * Registration order matters: this plugin MUST be registered BEFORE
 * clerkAuthPlugin so that request.user is set before Clerk checks run.
 * The Clerk plugin skips wbl_ak_ tokens independently.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { validateApiKey } from '../routes/api-keys.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set when the request is authenticated via a Wooblay API key. */
    apiKeyId?: string;
  }
}

export const apiKeyAuthPlugin = fp(async function apiKeyAuthPluginInner(app: FastifyInstance): Promise<void> {
  app.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (request.method === 'OPTIONS') return;
      if (!request.url.startsWith('/api/')) return;

      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer wbl_ak_')) return;

      const rawKey = authHeader.slice('Bearer '.length);
      const validation = await validateApiKey(rawKey);

      if (!validation.valid) {
        return reply.code(401).send({
          error: `API key authentication failed: ${validation.reason}`,
        });
      }

      // Set request.user with the same shape Clerk auth uses so
      // getOrgScope() and resolveOrgIdForRequest() work transparently.
      request.user = {
        clerkId: `apikey:${validation.apiKeyId}`,
        orgId: validation.orgId ?? null,
        role: 'api_key',
      };
      request.apiKeyId = validation.apiKeyId;
    },
  );
});
