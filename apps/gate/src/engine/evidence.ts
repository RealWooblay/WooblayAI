/**
 * Evidence Engine — "prove before impact."
 *
 * Produces tamper-evident evidence bundles that prove what WILL happen
 * before an action touches production. The MVP recipe is CI Replay:
 * run the same tests at commit A (last-known-good) and commit B (current),
 * diff the results, and hash everything for reproducibility.
 */

import { createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';
import { captureEnvironment, persistEnvironment } from './evidence-env.js';

const execAsync = promisify(exec);

// ── Types ───────────────────────────────────────────────────────────────

export interface CIReplayInput {
  runId: string;
  repoUrl: string;
  baseCommit: string;
  headCommit: string;
  testCommand: string;
  setupCommand?: string;
  environmentVars?: Record<string, string>;
}

interface TestRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

interface StructuredDiffResult {
  baseCommit: string;
  headCommit: string;
  baseTestResult: TestRunResult;
  headTestResult: TestRunResult;
  newFailures: string[];
  fixedTests: string[];
}

// ── Evidence Bundle Creation ────────────────────────────────────────────

export async function createEvidenceBundle(
  prisma: PrismaClient,
  runId: string,
  recipeType: string,
): Promise<string> {
  const bundle = await prisma.evidenceBundle.create({
    data: {
      runId,
      recipeType,
      status: 'pending',
    },
  });

  await persistEvent(prisma, {
    type: 'evidence.started',
    data: { evidenceId: bundle.id, runId, recipeType },
  });

  return bundle.id;
}

// ── CI Replay Recipe ────────────────────────────────────────────────────

export async function runCIReplayRecipe(
  prisma: PrismaClient,
  bundleId: string,
  input: CIReplayInput,
): Promise<void> {
  const startedAt = new Date();

  await prisma.evidenceBundle.update({
    where: { id: bundleId },
    data: { status: 'running', startedAt },
  });

  try {
    // Create temp directories for isolated execution
    const workDir = await mkdtemp(join(tmpdir(), 'wooblay-evidence-'));
    const baseDir = join(workDir, 'base');
    const headDir = join(workDir, 'head');

    // Compute environment hash
    const envHash = hashObject({
      testCommand: input.testCommand,
      setupCommand: input.setupCommand,
      environmentVars: input.environmentVars,
    });

    // Compute inputs hash
    const inputsHash = hashObject({
      repoUrl: input.repoUrl,
      baseCommit: input.baseCommit,
      headCommit: input.headCommit,
      envHash,
    });

    let baseResult: TestRunResult;
    let headResult: TestRunResult;

    try {
      // Clone and checkout base commit (last-known-good)
      await execAsync(`git clone --depth 50 ${input.repoUrl} ${baseDir}`, {
        timeout: 120_000,
        env: { ...process.env, ...input.environmentVars },
      });
      await execAsync(`git checkout ${input.baseCommit}`, { cwd: baseDir, timeout: 30_000 });

      // Clone and checkout head commit (current)
      await execAsync(`git clone --depth 50 ${input.repoUrl} ${headDir}`, {
        timeout: 120_000,
        env: { ...process.env, ...input.environmentVars },
      });
      await execAsync(`git checkout ${input.headCommit}`, { cwd: headDir, timeout: 30_000 });

      // Run setup if specified
      if (input.setupCommand) {
        await safeExec(input.setupCommand, baseDir, input.environmentVars);
        await safeExec(input.setupCommand, headDir, input.environmentVars);
      }

      // Run tests on both
      baseResult = await runTests(input.testCommand, baseDir, input.environmentVars);
      headResult = await runTests(input.testCommand, headDir, input.environmentVars);
    } finally {
      // Clean up temp directories
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }

    // Capture environment manifest for reproducibility
    try {
      const envManifest = await captureEnvironment(headDir, input.environmentVars);
      await persistEnvironment(prisma, bundleId, envManifest);
    } catch {
      // Non-fatal: environment capture failure shouldn't block evidence
    }

    // Compute structured diff
    const diff = computeStructuredDiff(input.baseCommit, input.headCommit, baseResult, headResult);

    // Compute outputs hash
    const outputsHash = hashObject({
      baseExitCode: baseResult.exitCode,
      baseStdout: baseResult.stdout,
      headExitCode: headResult.exitCode,
      headStdout: headResult.stdout,
    });

    // Extract failing test names from output
    const failingTests = extractFailingTests(headResult);

    // Update evidence bundle
    await prisma.evidenceBundle.update({
      where: { id: bundleId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        environmentHash: envHash,
        inputsHash,
        outputsHash,
        structuredDiff: JSON.stringify(diff),
        failingTests: failingTests.length > 0 ? JSON.stringify(failingTests) : null,
        reproducible: true,
      },
    });

    await persistEvent(prisma, {
      type: 'evidence.completed',
      data: { evidenceId: bundleId, status: 'completed', reproducible: true },
    });
  } catch (err: any) {
    await prisma.evidenceBundle.update({
      where: { id: bundleId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        logArtifacts: JSON.stringify([err.message]),
      },
    });

    await persistEvent(prisma, {
      type: 'evidence.completed',
      data: { evidenceId: bundleId, status: 'failed', reproducible: false },
    });
  }
}

// ── Manual Evidence Bundle ──────────────────────────────────────────────

export async function createManualEvidence(
  prisma: PrismaClient,
  runId: string,
  data: {
    structuredDiff?: string;
    failingTests?: string;
    environmentHash?: string;
    inputsHash?: string;
    outputsHash?: string;
  },
): Promise<string> {
  const bundle = await prisma.evidenceBundle.create({
    data: {
      runId,
      recipeType: 'manual',
      status: 'completed',
      completedAt: new Date(),
      startedAt: new Date(),
      environmentHash: data.environmentHash ?? null,
      inputsHash: data.inputsHash ?? null,
      outputsHash: data.outputsHash ?? null,
      structuredDiff: data.structuredDiff ?? null,
      failingTests: data.failingTests ?? null,
      reproducible: false,
    },
  });

  await persistEvent(prisma, {
    type: 'evidence.completed',
    data: { evidenceId: bundle.id, status: 'completed', reproducible: false },
  });

  return bundle.id;
}

// ── Helpers ─────────────────────────────────────────────────────────────

async function runTests(
  command: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<TestRunResult> {
  const start = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd,
      timeout: 300_000, // 5 min max
      maxBuffer: 10 * 1024 * 1024, // 10MB
      env: { ...process.env, ...env },
    });
    return {
      exitCode: 0,
      stdout: stdout.slice(0, 50_000), // Cap at 50KB
      stderr: stderr.slice(0, 50_000),
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      exitCode: err.code ?? 1,
      stdout: (err.stdout ?? '').slice(0, 50_000),
      stderr: (err.stderr ?? '').slice(0, 50_000),
      durationMs: Date.now() - start,
    };
  }
}

async function safeExec(
  command: string,
  cwd: string,
  env?: Record<string, string>,
): Promise<void> {
  try {
    await execAsync(command, {
      cwd,
      timeout: 300_000,
      env: { ...process.env, ...env },
    });
  } catch {
    // Setup failures are not fatal
  }
}

function computeStructuredDiff(
  baseCommit: string,
  headCommit: string,
  baseResult: TestRunResult,
  headResult: TestRunResult,
): StructuredDiffResult {
  // Extract test names from output (simple heuristic)
  const baseFailures = extractTestNames(baseResult.stderr + baseResult.stdout, false);
  const headFailures = extractTestNames(headResult.stderr + headResult.stdout, false);

  const baseSet = new Set(baseFailures);
  const headSet = new Set(headFailures);

  const newFailures = headFailures.filter((t) => !baseSet.has(t));
  const fixedTests = baseFailures.filter((t) => !headSet.has(t));

  return {
    baseCommit,
    headCommit,
    baseTestResult: baseResult,
    headTestResult: headResult,
    newFailures,
    fixedTests,
  };
}

function extractTestNames(output: string, passing: boolean): string[] {
  const names: string[] = [];
  // Common test output patterns
  const patterns = [
    /FAIL\s+(.+)/g,      // Jest: FAIL path/to/test.ts
    /✕\s+(.+)/g,         // Jest: ✕ test name
    /✗\s+(.+)/g,         // Mocha: ✗ test name
    /FAILED\s+(.+)/g,    // pytest: FAILED test_name
    /Error:\s+(.+)/g,    // Generic error
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      if (match[1]) names.push(match[1].trim());
    }
  }

  return [...new Set(names)];
}

function extractFailingTests(result: TestRunResult): { name: string; error: string; isNew: boolean }[] {
  if (result.exitCode === 0) return [];

  const names = extractTestNames(result.stderr + result.stdout, false);
  return names.map((name) => ({
    name,
    error: result.stderr.slice(0, 500),
    isNew: true, // Caller should compare with base to determine
  }));
}

function hashObject(obj: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(obj))
    .digest('hex');
}

/** Hash a string value for tamper evidence. */
export function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
