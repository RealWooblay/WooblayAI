import { spawn, type ChildProcess } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BUFFER_SIZE = 1024 * 1024; // 1 MB

export interface SpawnOptions {
  /** Working directory for the child process. */
  cwd?: string;
  /** Maximum execution time in milliseconds (default: 30 000). */
  timeout?: number;
  /** Additional environment variables merged with process.env. */
  env?: Record<string, string>;
}

export interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Spawn a shell command and capture its output.
 *
 * - Uses `shell: true` so pipes, redirections, etc. work
 * - Enforces a configurable timeout (default 30s)
 * - Caps stdout/stderr capture at 1 MB each
 * - Kills the process tree on timeout
 */
export function spawnCommand(
  command: string,
  options: SpawnOptions = {},
): Promise<SpawnResult> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise<SpawnResult>((resolve) => {
    const startTime = Date.now();
    let timedOut = false;

    const child: ChildProcess = spawn(command, [], {
      shell: true,
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let stdoutTruncated = false;
    let stderrTruncated = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      if (!stdoutTruncated) {
        stdout += chunk.toString('utf-8');
        if (stdout.length > MAX_BUFFER_SIZE) {
          stdout = stdout.slice(0, MAX_BUFFER_SIZE);
          stdoutTruncated = true;
        }
      }
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      if (!stderrTruncated) {
        stderr += chunk.toString('utf-8');
        if (stderr.length > MAX_BUFFER_SIZE) {
          stderr = stderr.slice(0, MAX_BUFFER_SIZE);
          stderrTruncated = true;
        }
      }
    });

    const timer = setTimeout(() => {
      timedOut = true;
      // Kill the entire process group
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch {
        // Process may have already exited
        child.kill('SIGKILL');
      }
    }, timeout);

    child.on('close', (exitCode: number | null) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      if (stdoutTruncated) {
        stdout += '\n... [output truncated at 1 MB]';
      }
      if (stderrTruncated) {
        stderr += '\n... [output truncated at 1 MB]';
      }

      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? (timedOut ? -1 : null),
        durationMs,
        timedOut,
      });
    });

    // Handle spawn errors (e.g., command not found)
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;
      resolve({
        stdout,
        stderr: stderr + `\nSpawn error: ${err.message}`,
        exitCode: -1,
        durationMs,
        timedOut: false,
      });
    });
  });
}
