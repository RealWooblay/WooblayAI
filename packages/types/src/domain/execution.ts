export type ExecStatus = 'running' | 'completed' | 'failed' | 'timeout';

export interface Execution {
  id: string;
  toolCallId: string;
  status: ExecStatus;
  stdout: string | null;
  stderr: string | null;
  exitCode: number | null;
  durationMs: number | null;
  artifactsMeta: string | null; // JSON
  createdAt: string;
}
