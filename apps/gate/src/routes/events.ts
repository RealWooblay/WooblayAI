/**
 * Events route registration.
 *
 * Re-exports the SSE plugin so it can be registered alongside other route
 * modules in the main server.
 */

import type { FastifyInstance } from 'fastify';
import { ssePlugin } from '../events/sse.js';

export async function eventRoutes(app: FastifyInstance): Promise<void> {
  await app.register(ssePlugin);
}
