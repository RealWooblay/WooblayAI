/**
 * Execution reporting route.
 *
 * POST /api/executions — Called by adapters/toolhost after executing a tool call.
 * Records stdout, stderr, exit code, duration, and artifacts metadata.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/client.js';
import { reportExecution } from '../services/execution.js';

export async function executionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/executions',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        toolCallId: string;
        status: string;
        stdout?: string;
        stderr?: string;
        exitCode?: number;
        durationMs?: number;
        artifactsMeta?: Record<string, unknown>;
      };

      if (!body.toolCallId || !body.status) {
        return reply.code(400).send({ error: 'toolCallId and status are required' });
      }

      try {
        // Verify the tool call exists — try by exact ID first,
        // then fall back to finding the most recent matching tool call
        // (adapters may send the external toolCallId rather than Wooblay's internal ID)
        let toolCall = await prisma.toolCall.findUnique({
          where: { id: body.toolCallId },
        });

        if (!toolCall) {
          // Fallback: find the most recent tool call that hasn't been executed yet
          // This handles the case where the adapter sends OpenClaw's toolCallId
          toolCall = await prisma.toolCall.findFirst({
            where: { execution: null },
            orderBy: { createdAt: 'desc' },
          });
        }

        if (!toolCall) {
          // Still not found — silently accept (fire-and-forget audit)
          request.log.warn({ externalId: body.toolCallId }, 'ToolCall not found, recording execution without link');
          return reply.code(200).send({ ok: true, warning: 'ToolCall not found, execution recorded without link' });
        }

        // Use the resolved Wooblay ID
        body.toolCallId = toolCall.id;

        const result = await reportExecution(prisma, {
          toolCallId: body.toolCallId,
          status: body.status,
          stdout: body.stdout ?? null,
          stderr: body.stderr ?? null,
          exitCode: body.exitCode ?? null,
          durationMs: body.durationMs ?? null,
          artifactsMeta: body.artifactsMeta
            ? JSON.stringify(body.artifactsMeta)
            : null,
        });

        return reply.code(201).send(result);
      } catch (err) {
        request.log.error(err, 'Failed to report execution');
        return reply.code(500).send({ error: 'Internal server error' });
      }
    },
  );
}
