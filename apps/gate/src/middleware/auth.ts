/**
 * Authentication middleware.
 *
 * Reads the `x-agent-pubkey` and `x-request-signature` headers, verifies the
 * Ed25519 signature over the request body, and decorates the request with the
 * authenticated agent public key.
 *
 * GET requests and the /health endpoint are excluded from verification.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verify } from '@wooblay/crypto';

// Augment Fastify's request type so `agentPubkey` is available downstream
declare module 'fastify' {
  interface FastifyRequest {
    agentPubkey?: string;
  }
}

/**
 * Register the auth hook on a Fastify instance.
 */
export async function authPlugin(app: FastifyInstance): Promise<void> {
  app.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip verification for safe methods and health checks
      if (request.method === 'GET' || request.method === 'OPTIONS') return;
      if (request.url === '/health' || request.url === '/health/') return;

      // Skip for GitHub webhook (uses its own HMAC-SHA256 verification)
      if (request.url === '/github/webhook' || request.url === '/github/webhook/') return;

      // Skip agent auth for platform API routes (these use Clerk auth instead)
      const platformPaths = [
        '/api/users/', '/api/coupons/', '/api/instances',
        '/api/webhooks/', '/api/sync/', '/api/approvals/',
        '/api/policies', '/api/stats', '/api/activity',
        '/api/receipts',
      ];
      const path = request.url.split('?')[0];
      if (platformPaths.some((p) => path.startsWith(p))) return;

      const pubkey = request.headers['x-agent-pubkey'] as string | undefined;
      const signature = request.headers['x-request-signature'] as string | undefined;

      if (!pubkey || !signature) {
        return reply.code(401).send({
          error: 'Missing authentication headers (x-agent-pubkey, x-request-signature)',
        });
      }

      // Verify the signature over the raw body
      const isValid = verify(request.body, signature, pubkey);

      if (!isValid) {
        return reply.code(401).send({ error: 'Invalid request signature' });
      }

      // Decorate request with the verified agent public key
      request.agentPubkey = pubkey;
    },
  );
}
