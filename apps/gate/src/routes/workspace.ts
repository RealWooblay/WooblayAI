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

/** Run a docker exec command and return stdout. Returns empty string on failure. */
function dockerExec(container: string, cmd: string, timeout = 10_000): string {
  try {
    return execSync(`docker exec "${container}" sh -c '${cmd.replace(/'/g, "'\\''")}'`, {
      timeout,
      stdio: 'pipe',
      maxBuffer: 2 * 1024 * 1024,
    }).toString();
  } catch (err: any) {
    // Return stderr/stdout from the failed command if available
    if (err.stdout) return err.stdout.toString();
    return '';
  }
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

      // List files with metadata using ls -la (works on Alpine/BusyBox)
      // Also ensure the directory exists first
      const raw = dockerExec(
        container,
        `if [ -d "${target}" ]; then ls -la "${target}" 2>/dev/null; else echo "NOTDIR"; fi`,
      );

      if (raw.trim() === 'NOTDIR') {
        return reply.code(404).send({ error: 'Directory not found' });
      }

      // Parse ls -la output: drwxr-xr-x  2 root root 4096 Jan 15 12:00 dirname
      const entries = raw
        .trim()
        .split('\n')
        .filter(Boolean)
        .filter(line => !line.startsWith('total ')) // skip "total N" header
        .map((line) => {
          const parts = line.split(/\s+/);
          if (parts.length >= 9) {
            const perms = parts[0];
            const size = parseInt(parts[4], 10) || 0;
            const name = parts.slice(8).join(' ');
            const type = perms.startsWith('d') ? 'dir' : 'file';
            // Approximate modified from ls output (month day time/year)
            const dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
            return { name, type, size, modified: dateStr };
          }
          return null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null && e.name !== '.' && e.name !== '..')
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

  /**
   * POST /api/instances/:id/files/write — Write file content into container.
   * Body: { path: string, content: string }
   */
  app.post('/api/instances/:id/files/write', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { path: filePath, content } = request.body as { path?: string; content?: string };

    if (!filePath || content === undefined) {
      return reply.code(400).send({ error: 'path and content are required' });
    }

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) return reply.code(404).send({ error: 'Instance not found' });

      const container = containerName(instance.name);
      const target = safePath(filePath);

      // Check container is running
      const running = execSync(
        `docker ps -q --filter "name=${container}"`,
        { timeout: 5000, stdio: 'pipe' },
      ).toString().trim();

      if (!running) {
        return reply.code(400).send({ error: 'Agent is not running' });
      }

      // Base64 encode content in Node, decode in container — no escaping issues
      const encoded = Buffer.from(content, 'utf-8').toString('base64');

      execSync(
        `echo '${encoded}' | docker exec -i "${container}" sh -c 'base64 -d > "${target}"'`,
        { timeout: 10_000, stdio: 'pipe' },
      );

      return reply.send({ ok: true, path: target, size: content.length });
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to write file');
      return reply.code(500).send({ error: 'Failed to write file' });
    }
  });
}
