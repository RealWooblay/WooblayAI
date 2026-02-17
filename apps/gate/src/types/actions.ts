/** Structured action types for the Action Registry + Secure Execution Engine. */

export interface ActionSpec {
  /** The structured action ID (e.g. "git:push", "github:pr:create") */
  action: string;
  /** Parameters from the agent */
  params: Record<string, unknown>;
}

export interface ExecutionSpec {
  /** The exact shell command to run (with params substituted) */
  command: string;
  /** Environment variables to set (credentials injected here) */
  env: Record<string, string>;
  /** Docker image to use for the execution container */
  image: string;
  /** Network endpoints the container is allowed to reach */
  allowedEndpoints: string[];
  /** Whether to mount the agent workspace (read-only) */
  mountWorkspace: boolean;
  /** Working directory inside the container */
  workdir: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Provider for credential lookup */
  provider: string;
  /** Human-readable description of what this will do */
  description: string;
}

export interface ActionDefinition {
  /** Provider (github, aws, gcp) */
  provider: string;
  /** Docker image for execution */
  image: string;
  /** Allowed network endpoints */
  allowedEndpoints: string[];
  /** Whether workspace is needed */
  mountWorkspace: boolean;
  /** Default timeout */
  timeoutMs: number;
  /** Build the execution command from params */
  buildCommand: (params: Record<string, unknown>) => string;
  /** Build the execution environment (without credentials — those are injected separately) */
  buildEnv: (params: Record<string, unknown>) => Record<string, string>;
  /** Describe what this action will do */
  describe: (params: Record<string, unknown>) => string;
  /** Validate params before execution */
  validate: (params: Record<string, unknown>) => { valid: boolean; error?: string };
  /** Build a dry-run command (for simulation) */
  buildDryRunCommand?: (params: Record<string, unknown>) => string | null;
}
