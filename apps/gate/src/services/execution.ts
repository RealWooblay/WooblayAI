/**
 * Execution service.
 *
 * Records the outcome of a tool execution (stdout, stderr, exit code, etc.).
 */

import type { PrismaClient } from '@prisma/client';

export interface ReportExecutionData {
  toolCallId: string;
  status: string;
  stdout?: string | null;
  stderr?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  artifactsMeta?: string | null;
}

/**
 * Create an execution record for a completed (or failed) tool call.
 */
export async function reportExecution(
  prisma: PrismaClient,
  data: ReportExecutionData,
): Promise<{ id: string }> {
  const execution = await prisma.execution.create({
    data: {
      toolCallId: data.toolCallId,
      status: data.status,
      stdout: data.stdout ?? null,
      stderr: data.stderr ?? null,
      exitCode: data.exitCode ?? null,
      durationMs: data.durationMs ?? null,
      artifactsMeta: data.artifactsMeta ?? null,
    },
  });

  return { id: execution.id };
}
