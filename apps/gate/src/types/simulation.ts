/** Pre-execution simulation types. */

import type { ActionSpec } from './actions.js';

/** Simulation threshold levels for org policy settings. */
export type SimulationThreshold = 'critical_only' | 'high' | 'medium' | 'all';

/** Single universal strategy — sandbox execution + AI intent verification. */
export type SimulationStrategy = 'SANDBOX_EXEC' | 'CONTENT_ANALYSIS';

export interface AIIntentAnalysis {
  /** Does the command's behavior match its stated intent? */
  intentMatch: boolean;
  /** AI's reasoning for the decision */
  reasoning: string;
  /** What the AI observed the command doing */
  observedBehavior: string;
  /** Specific discrepancies between intent and behavior (empty if match) */
  discrepancies: string[];
}

export interface SimulationResult {
  /** Did the simulation pass (intent matches behavior)? */
  passed: boolean;
  /** Which strategy was used */
  strategy: SimulationStrategy;
  /** Human-readable summary */
  summary: string;
  /** Structured details (sandbox output, checks) */
  details: Record<string, unknown>;
  /** AI intent verification result */
  aiAnalysis?: AIIntentAnalysis;
  /** Duration of simulation */
  durationMs: number;
}

export interface SimulationRequest {
  /** Action to simulate */
  actionSpec: ActionSpec;
  /** Connection for credential access (used in L3, not in sandbox) */
  connectionId: string;
  /** Run ID for logging */
  runId: string;
  /** Agent workspace path */
  workspacePath?: string;
  /** Stated intent / operation context (for intent comparison) */
  statedIntent?: string;
}

/**
 * Request for simulating a local tool call (exec, write, etc.)
 * Used when the layer routing triggers L2 for a local action.
 */
export interface LocalSimulationRequest {
  /** Tool name (exec, write, edit, web_fetch) */
  toolName: string;
  /** Tool arguments */
  args: Record<string, unknown>;
  /** AI risk tier that triggered simulation */
  riskTier: string;
  /** AI-generated description of the action */
  aiDescription?: string;
  /** Run/session ID for logging */
  runId: string;
}
