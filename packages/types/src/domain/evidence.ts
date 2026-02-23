export type EvidenceRecipeType = 'ci_replay' | 'manual';
export type EvidenceStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface EvidenceBundle {
  id: string;
  runId: string;
  recipeType: EvidenceRecipeType;
  status: EvidenceStatus;
  environmentHash: string | null;
  inputsHash: string | null;
  outputsHash: string | null;
  structuredDiff: StructuredDiff | null;
  failingTests: FailingTest[] | null;
  logArtifacts: string[] | null;
  reproducible: boolean;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface StructuredDiff {
  baseCommit: string;
  headCommit: string;
  baseTestResult: TestSuiteResult;
  headTestResult: TestSuiteResult;
  newFailures: string[];
  fixedTests: string[];
  unchangedFailures: string[];
}

export interface TestSuiteResult {
  exitCode: number;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  stdout: string;
  stderr: string;
}

export interface FailingTest {
  name: string;
  file: string | null;
  error: string;
  stackTrace: string | null;
  isNew: boolean;
}
