/**
 * Static file serving for the Gate UI.
 *
 * If a `public` directory exists one level up from the source root (i.e.
 * apps/gate/public), we serve it at the root path. This allows the Gate
 * server to double as the UI host in single-binary deployments.
 */

import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function registerStatic(app: FastifyInstance): Promise<void> {
  const publicDir = resolve(__dirname, '../public');

  if (!existsSync(publicDir)) {
    app.log.info('No public/ directory found — skipping static file serving');
    return;
  }

  // Dynamic import so the server still boots even if @fastify/static isn't installed
  const fastifyStatic = await import('@fastify/static');
  await app.register(fastifyStatic.default, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
  });

  app.log.info(`Serving static files from ${publicDir}`);
}
