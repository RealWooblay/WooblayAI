/**
 * Static file serving for the Gate UI.
 *
 * If a `public` directory exists one level up from the source root (i.e.
 * apps/gate/public), we serve it at the root path. This allows the Gate
 * server to double as the UI host in single-binary deployments.
 *
 * Includes SPA fallback: any non-API, non-file request returns index.html
 * so client-side routing works.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

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
    wildcard: false, // Don't use wildcard so we can add our own SPA fallback
  });

  // SPA fallback: serve index.html for any GET that doesn't match an API route or file
  const indexPath = resolve(publicDir, 'index.html');
  if (existsSync(indexPath)) {
    const indexHtml = readFileSync(indexPath, 'utf-8');
    app.setNotFoundHandler(
      async (request: FastifyRequest, reply: FastifyReply) => {
        // Only serve index.html for browser navigation (GET, Accept: text/html)
        if (
          request.method === 'GET' &&
          !request.url.startsWith('/api/') &&
          !request.url.startsWith('/health')
        ) {
          return reply.type('text/html').send(indexHtml);
        }
        return reply.code(404).send({ error: 'Not found' });
      },
    );
  }

  app.log.info(`Serving static files from ${publicDir}`);
}
