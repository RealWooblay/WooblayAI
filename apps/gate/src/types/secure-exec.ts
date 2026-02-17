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
}

export interface SecureExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  containerId: string;
  description: string;
  error?: string;
}
