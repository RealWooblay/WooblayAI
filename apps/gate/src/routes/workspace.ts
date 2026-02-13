/**
 * Workspace file explorer routes.
 *
 * Provides live filesystem access to running agent containers via docker exec.
 * All paths are sandboxed to /root/clawd (the agent workspace).
 *
 * GET  /api/instances/:id/files            — List directory contents
 * GET  /api/instances/:id/files/read       — Read file content
 * GET  /api/instances/:id/files/download   — Download raw file
 * POST /api/instances/:id/files/write      — Write file content
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
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

interface ExecResult {
  stdout: string;
  stderr: string;
  ok: boolean;
  exitCode: number | null;
}

/** Run a docker exec command. Returns stdout, stderr, and success status. */
function dockerExec(containerIdOrName: string, cmd: string, timeout = 10_000): ExecResult {
  try {
    const stdout = execSync(`docker exec "${containerIdOrName}" sh -c '${cmd.replace(/'/g, "'\\''")}'`, {
      timeout,
      stdio: 'pipe',
      maxBuffer: 2 * 1024 * 1024,
    }).toString();
    return { stdout, stderr: '', ok: true, exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
      ok: false,
      exitCode: err.status ?? null,
    };
  }
}

/** Find a running container by name. Returns { id, name } or null. */
function getRunningContainer(name: string): { id: string; name: string } | null {
  try {
    // Get container ID + name with format filter
    const out = execSync(
      `docker ps --filter "name=${name}" --format "{{.ID}}|{{.Names}}"`,
      { timeout: 5000, stdio: 'pipe' },
    ).toString().trim();

    if (!out) return null;

    // Pick the first line that matches (docker name filter is substring-based)
    for (const line of out.split('\n').filter(Boolean)) {
      const [id, cname] = line.split('|');
      if (id && cname) {
        // Prefer exact match
        if (cname === name) return { id: id.trim(), name: cname.trim() };
      }
    }

    // No exact match — use first result (substring match)
    const [id, cname] = out.split('\n')[0].split('|');
    if (id) return { id: id.trim(), name: (cname ?? name).trim() };

    return null;
  } catch {
    return null;
  }
}

// Use fp() so routes register in the parent scope (avoids encapsulation issues)
async function workspaceRoutesInner(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/instances/:id/files — List directory contents.
   */
  app.get('/api/instances/:id/files', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const { path: dirPath } = request.query as { path?: string };

    request.log.info({ id, dirPath }, 'Workspace: listing files');

    try {
      const instance = await prisma.instance.findUnique({ where: { id } });
      if (!instance) {
        request.log.warn({ id }, 'Workspace: instance not found in DB');
        return reply.code(404).send({ error: 'Instance not found', instanceId: id });
      }

      const cname = containerName(instance.name);
      const target = safePath(dirPath);

      // Check if container is running — get its actual ID
      const cinfo = getRunningContainer(cname);
      if (!cinfo) {
        request.log.warn({ cname }, 'Workspace: container not running');
        return reply.code(400).send({ error: 'Agent is not running', container: cname });
      }

      request.log.info({ cname, containerId: cinfo.id, containerName: cinfo.name, target }, 'Workspace: found container');

      // Use container ID for docker exec (more reliable than name)
      const cid = cinfo.id;

      // Ensure workspace root exists inside container, then list
      const result = dockerExec(
        cid,
        `mkdir -p "${WORKSPACE_ROOT}" && if [ -d "${target}" ]; then ls -la "${target}" 2>/dev/null; else echo "NOTDIR"; fi`,
      );

      request.log.info({
        ok: result.ok,
        exitCode: result.exitCode,
        stdoutLen: result.stdout.length,
        stderrLen: result.stderr.length,
        stdoutPreview: result.stdout.slice(0, 300),
        stderrPreview: result.stderr.slice(0, 300),
      }, 'Workspace: docker exec result');

      // If docker exec failed entirely, return error with debug info
      if (!result.ok && !result.stdout.trim()) {
        return reply.code(502).send({
          error: 'Failed to execute command in agent container',
          container: cinfo.name,
          containerId: cid,
          stderr: result.stderr.slice(0, 500),
          exitCode: result.exitCode,
        });
      }

      const raw = result.stdout;

      if (raw.trim() === 'NOTDIR') {
        if (target === WORKSPACE_ROOT) {
          dockerExec(cid, `mkdir -p "${WORKSPACE_ROOT}"`);
          return reply.send({ path: target, entries: [] });
        }
        return reply.code(404).send({ error: 'Directory not found', path: target, container: cinfo.name });
      }

      if (!raw.trim()) {
        // Empty stdout but exec succeeded — directory is genuinely empty
        return reply.send({ path: target, entries: [] });
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
            const dateStr = `${parts[5]} ${parts[6]} ${parts[7]}`;
            return { name, type, size, modified: dateStr };
          }
          return null;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null && e.name !== '.' && e.name !== '..')
        .sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      return reply.send({ path: target, entries });
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to list files');
      return reply.code(500).send({ error: 'Failed to list files', detail: err.message });
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

      const cname = containerName(instance.name);
      const target = safePath(filePath);

      const cinfo = getRunningContainer(cname);
      if (!cinfo) {
        return reply.code(400).send({ error: 'Agent is not running' });
      }
      const cid = cinfo.id;

      // Check file size first (use wc -c — portable across Debian/Alpine)
      const sizeResult = dockerExec(cid, `wc -c < "${target}" 2>/dev/null || echo 0`);
      const size = parseInt(sizeResult.stdout.trim(), 10) || 0;

      if (size > MAX_FILE_SIZE) {
        const headResult = dockerExec(cid, `head -c ${MAX_FILE_SIZE} "${target}"`);
        return reply.send({
          path: target,
          size,
          truncated: true,
          content: headResult.stdout,
          warning: `File is ${(size / 1024).toFixed(0)}KB — showing first 1MB`,
        });
      }

      const catResult = dockerExec(cid, `cat "${target}"`);

      return reply.send({
        path: target,
        size,
        content: catResult.stdout,
        truncated: false,
      });
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to read file');
      return reply.code(500).send({ error: 'Failed to read file', detail: err.message });
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

      const cname = containerName(instance.name);
      const target = safePath(filePath);

      const cinfo = getRunningContainer(cname);
      if (!cinfo) {
        return reply.code(400).send({ error: 'Agent is not running' });
      }

      const content = execSync(
        `docker exec "${cinfo.id}" cat "${target}"`,
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
      return reply.code(500).send({ error: 'Failed to download file', detail: err.message });
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

      const cname = containerName(instance.name);
      const target = safePath(filePath);

      // Check container is running
      const cinfo = getRunningContainer(cname);
      if (!cinfo) {
        return reply.code(400).send({ error: 'Agent is not running' });
      }
      const cid = cinfo.id;

      // Ensure parent directory exists
      const parentDir = target.substring(0, target.lastIndexOf('/'));
      if (parentDir) {
        dockerExec(cid, `mkdir -p "${parentDir}"`);
      }

      // Base64 encode content in Node, decode in container — no escaping issues
      const encoded = Buffer.from(content, 'utf-8').toString('base64');

      execSync(
        `echo '${encoded}' | docker exec -i "${cid}" sh -c 'base64 -d > "${target}"'`,
        { timeout: 10_000, stdio: 'pipe' },
      );

      return reply.send({ ok: true, path: target, size: content.length });
    } catch (err: any) {
      if (err.message === 'Invalid path') {
        return reply.code(400).send({ error: 'Invalid path' });
      }
      request.log.error(err, 'Failed to write file');
      return reply.code(500).send({ error: 'Failed to write file', detail: err.message });
    }
  });
}

export const workspaceRoutes = fp(workspaceRoutesInner, {
  name: 'workspace-routes',
});
