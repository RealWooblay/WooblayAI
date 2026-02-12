/**
 * Checkpoint routes.
 *
 * Creates directory snapshots (tarballs) that can be restored to roll back
 * file-system changes made by tool executions.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CreateCheckpointRequestSchema } from '@wooblay/schemas';
import { prisma } from '../db/client.js';
import { validateBody } from '../middleware/validate.js';

/** Directory where checkpoint tarballs are stored. */
const CHECKPOINT_DIR = resolve(process.cwd(), '.checkpoints');

export async function checkpointRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/checkpoints — Create a new checkpoint (tarball a directory).
   */
  app.post(
    '/api/checkpoints',
    { preHandler: validateBody(CreateCheckpointRequestSchema) },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        toolName: string;
        scope: string;
        path: string;
        metadata?: Record<string, unknown>;
      };

      try {
        const sourcePath = resolve(body.path);

        if (!existsSync(sourcePath)) {
          return reply.code(400).send({ error: `Path does not exist: ${body.path}` });
        }

        // Ensure the checkpoint storage directory exists
        mkdirSync(CHECKPOINT_DIR, { recursive: true });

        // Create the checkpoint record first to get the ID
        const checkpoint = await prisma.checkpoint.create({
          data: {
            toolName: body.toolName,
            scope: body.scope,
            path: body.path,
            metadata: body.metadata ? JSON.stringify(body.metadata) : null,
          },
        });

        // Create a tarball of the source path
        const tarballPath = join(CHECKPOINT_DIR, `${checkpoint.id}.tar.gz`);
        execSync(`tar -czf "${tarballPath}" -C "${sourcePath}" .`, {
          timeout: 60_000,
        });

        return reply.code(201).send(checkpoint);
      } catch (err) {
        request.log.error(err, 'Failed to create checkpoint');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );

  /**
   * POST /api/checkpoints/:id/restore — Restore a checkpoint.
   */
  app.post('/api/checkpoints/:id/restore', async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };

    try {
      const checkpoint = await prisma.checkpoint.findUnique({ where: { id } });

      if (!checkpoint) {
        return reply.code(404).send({ error: 'Checkpoint not found' });
      }

      const tarballPath = join(CHECKPOINT_DIR, `${checkpoint.id}.tar.gz`);

      if (!existsSync(tarballPath)) {
        return reply.code(404).send({ error: 'Checkpoint tarball not found on disk' });
      }

      const targetPath = resolve(checkpoint.path);

      // Ensure the target directory exists
      mkdirSync(targetPath, { recursive: true });

      // Extract the tarball into the target path
      execSync(`tar -xzf "${tarballPath}" -C "${targetPath}"`, {
        timeout: 60_000,
      });

      return reply.send({
        restored: true,
        checkpointId: checkpoint.id,
        path: checkpoint.path,
      });
    } catch (err) {
      request.log.error(err, 'Failed to restore checkpoint');
      return reply.code(500).send({ error: 'Internal server error' });
    }
  });
}
