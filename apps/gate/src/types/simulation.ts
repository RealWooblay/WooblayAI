/** Pre-execution simulation types. */

import type { ActionSpec } from './actions.js';

export type SimulationStrategy = 'DRY_RUN' | 'DIFF_PREVIEW' | 'API_CHECK' | 'EVIDENCE_BUNDLE';

export interface SimulationResult {
  /** Did the simulation pass? */
  passed: boolean;
  /** Which strategy was used? */
  strategy: SimulationStrategy;
  /** Human-readable summary */
  summary: string;
  /** Structured details (diff, output, checks) */
  details: Record<string, unknown>;
  /** Duration of simulation */
  durationMs: number;
}

export interface SimulationRequest {
  /** Action to simulate */
  actionSpec: ActionSpec;
  /** Connection for credential access */
  connectionId: string;
  /** Run ID for logging */
  runId: string;
  /** Agent workspace path */
  workspacePath?: string;
}
