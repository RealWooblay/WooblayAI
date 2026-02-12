import type { ChildProcess } from 'node:child_process';
import type { GateClient } from '@wooblay/gate-client';

/**
 * Stream stdout/stderr chunks from a child process to the Gate execution
 * reporting endpoint, providing real-time visibility into tool execution.
 *
 * This is a best-effort streaming mechanism: failures to report chunks
 * are logged but do not interrupt the child process.
 *
 * @param gateClient  - Configured GateClient instance
 * @param toolCallId  - The tool call ID to associate output with
 * @param child       - The spawned child process
 */
export function streamToGate(
  gateClient: GateClient,
  toolCallId: string,
  child: ChildProcess,
): void {
  let stdoutAccum = '';
  let stderrAccum = '';

  const flushInterval = setInterval(() => {
    void flush();
  }, 1_000);

  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutAccum += chunk.toString('utf-8');
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    stderrAccum += chunk.toString('utf-8');
  });

  child.on('close', () => {
    clearInterval(flushInterval);
    // Final flush
    void flush();
  });

  async function flush(): Promise<void> {
    if (!stdoutAccum && !stderrAccum) return;

    const stdoutChunk = stdoutAccum;
    const stderrChunk = stderrAccum;
    stdoutAccum = '';
    stderrAccum = '';

    try {
      await gateClient.reportExecution({
        toolCallId,
        status: 'running',
        ...(stdoutChunk ? { stdout: stdoutChunk } : {}),
        ...(stderrChunk ? { stderr: stderrChunk } : {}),
      });
    } catch (err) {
      console.error(
        `[streaming] Failed to stream output for ${toolCallId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}
