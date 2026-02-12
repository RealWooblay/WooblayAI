/**
 * Health check endpoint.
 */

import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    return {
      status: 'ok' as const,
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });
}
