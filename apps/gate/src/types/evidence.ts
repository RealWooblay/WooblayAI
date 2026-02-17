/** Evidence engine types. */

export interface CIReplayInput {
  runId: string;
  repoUrl: string;
  baseCommit: string;
  headCommit: string;
  testCommand: string;
  setupCommand?: string;
  environmentVars?: Record<string, string>;
}

export interface TestRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface StructuredDiffResult {
  baseCommit: string;
  headCommit: string;
  baseTestResult: TestRunResult;
  headTestResult: TestRunResult;
  newFailures: string[];
  fixedTests: string[];
}

export interface EnvironmentManifest {
  baseImageDigest: string | null;
  osVersion: string | null;
  toolchainVersions: Record<string, string>;
  dependencyHash: string | null;
  envVarHash: string | null;
  cacheStrategy: string;
}
