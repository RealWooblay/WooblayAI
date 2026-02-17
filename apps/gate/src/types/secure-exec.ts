/** Ephemeral secure execution types. */

import type { ActionSpec } from './actions.js';

export interface SecureExecRequest {
  /** The structured action to execute */
  actionSpec: ActionSpec;
  /** Connection ID to resolve credentials from */
  connectionId: string;
  /** Run ID for event logging */
  runId: string;
  /** Path to agent workspace (if workspace mount is needed) */
  workspacePath?: string;
  /** Whether to run dry-run simulation first */
  simulate?: boolean;
}

export interface SecureExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  containerId: string;
  description: string;
  /** Dry-run result (if simulation was requested) */
  simulation?: {
    passed: boolean;
    stdout: string;
    stderr: string;
    exitCode: number;
  };
  error?: string;
}
