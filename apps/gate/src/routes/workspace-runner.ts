/**
 * Workspace Runner routes — container lifecycle management.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { createWorkspace, stopWorkspace, getWorkspaceLogs, captureStatePointer } from '../services/workspace-runner.js';
import { config } from '../config.js';

export async function workspaceRunnerRoutes(app: FastifyInstance): Promise<void> {
  // ── Create a workspace for a run ──────────────────────────────────────
  app.post('/api/runs/:runId/workspace', async (request: FastifyRequest, reply: FastifyReply) => {
    const { runId } = request.params as { runId: string };
    const body = request.body as {
      repoUrl?: string;
      commitSha?: string;
      baseImage?: string;
      egressMode?: 'gateway_only' | 'unrestricted';
    };

    try {
      const state = await createWorkspace(prisma, {
        runId,
        repoUrl: body.repoUrl,
        commitSha: body.commitSha,
        baseImage: body.baseImage,
        gatewayHost: config.GATEWAY_HOST ?? '127.0.0.1',
        gatewayPort: config.PORT,
        egressMode: body.egressMode,
      });

      // Link workspace to run
      await prisma.run.update({
        where: { id: runId },
        data: { workspaceId: state.workspaceId },
      });

      return reply.send(state);
    } catch (err: any) {
      return reply.code(500).send({ error: `Failed to create workspace: ${err.message}` });
    }
  });

  // ── Stop a workspace ──────────────────────────────────────────────────
  app.post('/api/workspaces/:workspaceId/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.params as { workspaceId: string };

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

    // Find associated run
    const run = await prisma.run.findFirst({ where: { workspaceId } });
    if (!run) return reply.code(404).send({ error: 'No run associated with workspace' });

    await stopWorkspace(prisma, workspaceId, run.id);
    return reply.send({ stopped: true, workspaceId });
  });

  // ── Get workspace logs ────────────────────────────────────────────────
  app.get('/api/workspaces/:workspaceId/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const query = request.query as { tail?: string };

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace?.containerId) return reply.code(404).send({ error: 'Workspace or container not found' });

    const tail = parseInt(query.tail ?? '500', 10);
    const logs = await getWorkspaceLogs(workspace.containerId, tail);
    return reply.send({ logs });
  });

  // ── Capture state pointer ─────────────────────────────────────────────
  app.get('/api/workspaces/:workspaceId/state', async (request: FastifyRequest, reply: FastifyReply) => {
    const { workspaceId } = request.params as { workspaceId: string };

    try {
      const state = await captureStatePointer(prisma, workspaceId);
      return reply.send(state);
    } catch (err: any) {
      return reply.code(404).send({ error: err.message });
    }
  });

  // ── List workspaces ───────────────────────────────────────────────────
  app.get('/api/workspaces', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { status?: string };

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;

    const workspaces = await prisma.workspace.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return reply.send(workspaces);
  });
}
