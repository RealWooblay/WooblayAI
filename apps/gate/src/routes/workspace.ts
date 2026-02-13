/**
 * Workspace file explorer routes.
 *
 * Provides live filesystem access to running agent containers via docker exec.
 * All paths are sandboxed to /root/clawd (the agent workspace).
 *
 * GET /api/instances/:id/files            — List directory contents
 * GET /api/instances/:id/files/read       — Read file content
 * GET /api/instances/:id/files/download   — Download raw file
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { execSync } from 'child_process';

const WORKSPACE_ROOT = '/root/clawd';
const MAX_FILE_SIZE = 1_048_576; // 1MB

/** Validate and normalize a path to prevent traversal outside workspace root. */
function safePath(input?: string): string {
  if (!input) return WORKSPACE_ROOT;

  // Normalize: remove leading/trailing whitespace
  let p = (input ?? '').trim();

  // Must start with workspace root
  if (!p.startsWith(WORKSPACE_ROOT)) {
    p = `${WORKSPACE_ROOT}/${p}`.replace(/\/+/g, '/');
  }

  // Block traversal
  if (p.includes('..') || p.includes('\0')) {
    throw new Error('Invalid path');
  }

  return p;
}

/** Get the running container name for an instance. */
function containerName(instanceName: string): string {
  return `wooblay-agent-${instanceName}`;
}

/** Run a docker exec command and return stdout. */
function dockerExec(container: string, cmd: string, timeout = 10_000): string {
  return execSync(`docker exec "${container}" sh -c '${cmd.replace(/'/g, "'\\''")}'`, {
    timeout,
    stdio: 'pipe',
    maxBuffer: 2 * 1024 * 1024,
  }).toString();
}

export async function workspaceRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/instances/:id/files — List directory contents.
   */
  app.get('/api/instances/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { path: dirPath } = request.query as { path?: string };

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      const container = containerName(instance.name);
      const target = safePath(dirPath);

      // Check if container is running
      const running = execSync(
        `docker ps -q --filter "name=${container}"`,
        { timeout: 5000, stdio: 'pipe' },
      ).toString().trim();

      if (!running) {
        return reply.code(400).send({ error: 'Agent is not running' });
      }

      // List files with metadata: timestamp size type path
      const raw = dockerExec(
        container,
        `find "${target}" -maxdepth 1 -not -path "${target}" -printf "%T@ %s %y %f\\n" 2>/dev/null || ls -1 "${target}" 2>/dev/null`,
      );

      const entries = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(' ');
          if (parts.length >= 4) {
            // find -printf format: timestamp size type name
            const modified = new Date(parseFloat(parts[0]) * 1000).toISOString();
            const size = parseInt(parts[1], 10);
            const type = parts[2] === 'd' ? 'dir' : 'file';
            const name = parts.slice(3).join(' ');
            return { name, type, size, modified };
          }
          // Fallback: just the name from ls
          return { name: line, type: 'file' as const, size: 0, modified: null };
        })
        .sort((a, b) => {
          // Directories first, then alphabetical
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return reply.send({ path: target, entries });
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to list files');
      return reply.code(500).send({ error: 'Failed to list files' });
    }
  });

  /**
   * GET /api/instances/:id/files/read — Read file content.
   */
  app.get('/api/instances/:id/files/read', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { path: filePath } = request.query as { path?: string };

    if (!filePath) {
      return reply.code(400).send({ error: 'path query parameter required' });
    }

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      const container = containerName(instance.name);
      const target = safePath(filePath);

      // Check file size first
      const sizeStr = dockerExec(container, `stat -c '%s' "${target}" 2>/dev/null || echo 0`).trim();
      const size = parseInt(sizeStr, 10) || 0;

      if (size > MAX_FILE_SIZE) {
        return reply.send({
          path: target,
          size,
          truncated: true,
          content: dockerExec(container, `head -c ${MAX_FILE_SIZE} "${target}"`),
          warning: `File is ${(size / 1024).toFixed(0)}KB — showing first 1MB`,
        });
      }

      const content = dockerExec(container, `cat "${target}"`);

      return reply.send({
        path: target,
        size,
        content,
        truncated: false,
      });
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to read file');
      return reply.code(500).send({ error: 'Failed to read file' });
    }
  });

  /**
   * GET /api/instances/:id/files/download — Download raw file.
   */
  app.get('/api/instances/:id/files/download', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { path: filePath } = request.query as { path?: string };

    if (!filePath) {
      return reply.code(400).send({ error: 'path query parameter required' });
    }

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      const container = containerName(instance.name);
      const target = safePath(filePath);

      const content = execSync(
        `docker exec "${container}" cat "${target}"`,
        { timeout: 15_000, stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 },
      );

      const filename = target.split('/').pop() ?? 'download';

      return reply
        .header('Content-Type', 'application/octet-stream')
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .header('Content-Length', content.length)
        .send(content);
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to download file');
      return reply.code(500).send({ error: 'Failed to download file' });
    }
  });
}
