/**
 * Simulation Engine — sandbox execution + AI intent verification.
 *
 * Part of Wooblay's three-layer security moat:
 *   1. Policy Gate + Scope Boundaries → "Should this happen?"
 *   2. Simulation (this file)         → "Does this command do what it claims?"
 *   3. Secure Execution               → "Execute safely with real credentials"
 *
 * Simulation is NOT a security gate. Policy decides what's allowed.
 * Simulation verifies that the COMMAND matches the STATED INTENT:
 *   - Agent says "push feature branch" but force-pushes main → intent mismatch → FAIL
 *   - Agent says "delete cache" and runs rm -rf /tmp/cache → intent matches → PASS
 *   - Agent says "run tests" but exfiltrates data → sandbox exposes the lie → FAIL
 *
 * Two modes:
 *   - SANDBOX_EXEC: Run command in isolated container (--network none, no creds, 30s)
 *     Used for exec, structured_action, gateway actions
 *   - CONTENT_ANALYSIS: AI analyzes file content being written
 *     Used for write/edit when risk tier triggers simulation
 */

import type { PrismaClient } from '@prisma/client';
import { runSandboxExec } from './secure-exec.js';
import { emitRunEvent } from './run-events.js';
import { persistEvent } from '../events/bus.js';
import {
  buildSandboxAnalysisPrompt,
  buildSandboxAnalysisUserMessage,
  buildContentAnalysisPrompt,
  buildContentAnalysisUserMessage,
} from '../prompts/sandbox-analysis.js';

import type {
  SimulationStrategy,
  SimulationResult,
  SimulationRequest,
  LocalSimulationRequest,
  AIIntentAnalysis,
} from '../types/simulation.js';

export type { SimulationStrategy, SimulationResult, SimulationRequest, LocalSimulationRequest };

// ── AI Intent Verification ──────────────────────────────────────────────

async function analyzeWithAI(
  systemPrompt: string,
  userMessage: string,
): Promise<AIIntentAnalysis | null> {
  try {
    const { config } = await import('../config.js');
    if (!config.OPENAI_API_KEY) return null;

    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.OPENAI_API_KEY });

    const response = await client.chat.completions.create({
      model: config.OPENAI_MODEL ?? 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    const text = response.choices[0]?.message?.content ?? '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const result = JSON.parse(jsonMatch[0]);
    return {
      intentMatch: Boolean(result.intentMatch),
      reasoning: String(result.reasoning ?? ''),
      observedBehavior: String(result.observedBehavior ?? ''),
      discrepancies: Array.isArray(result.discrepancies) ? result.discrepancies.map(String) : [],
    };
  } catch (err) {
    console.warn('[simulate] AI analysis failed:', err);
    return null;
  }
}

// ── Sandbox Execution Strategy ──────────────────────────────────────────

async function runSandboxSimulation(
  prisma: PrismaClient,
  request: SimulationRequest,
): Promise<SimulationResult> {
  const startTime = Date.now();
  const { actionSpec, runId, workspacePath } = request;

  // Extract the command to sandbox
  const command = actionSpec.params.command
    ? String(actionSpec.params.command)
    : null;

  if (!command) {
    // No command to sandbox — pass through (registry shortcuts build commands later)
    return {
      passed: true,
      strategy: 'SANDBOX_EXEC',
      summary: 'No command to sandbox (action uses structured params)',
      details: { action: actionSpec.action, note: 'Command will be built at execution time' },
      durationMs: Date.now() - startTime,
    };
  }

  // Run in sandbox container
  const sandboxResult = await runSandboxExec(command, {
    image: actionSpec.params.image ? String(actionSpec.params.image) : undefined,
    workspacePath,
    timeoutMs: 30_000,
  });

  await emitRunEvent(prisma, runId, 'simulation_sandbox', {
    action: actionSpec.action,
    command: command.slice(0, 200),
    exitCode: sandboxResult.exitCode,
    durationMs: sandboxResult.durationMs,
    containerId: sandboxResult.containerId,
    stdoutPreview: sandboxResult.stdout.slice(0, 500),
    stderrPreview: sandboxResult.stderr.slice(0, 500),
  });

  // AI intent verification
  const statedIntent = request.statedIntent || actionSpec.action;
  const aiAnalysis = await analyzeWithAI(
    buildSandboxAnalysisPrompt(),
    buildSandboxAnalysisUserMessage(
      statedIntent,
      command,
      sandboxResult.stdout,
      sandboxResult.stderr,
      sandboxResult.exitCode,
    ),
  );

  // Decision: AI analysis is primary. Without AI, we CANNOT verify intent
  // from exit codes alone — sandbox has no network and read-only filesystem,
  // so most real commands (curl, git, npm install) fail with non-zero exit.
  // Fail-open: if AI is unavailable, pass through (policy already approved).
  const passed = aiAnalysis ? aiAnalysis.intentMatch : true;

  return {
    passed,
    strategy: 'SANDBOX_EXEC',
    summary: aiAnalysis
      ? (passed
        ? `Sandbox: intent matches — ${aiAnalysis.reasoning.slice(0, 200)}`
        : `Sandbox: intent MISMATCH — ${aiAnalysis.discrepancies.join('; ').slice(0, 200)}`)
      : `Sandbox: AI unavailable, passing through (exit ${sandboxResult.exitCode} — expected in sandbox)`,
    details: {
      sandboxExitCode: sandboxResult.exitCode,
      sandboxStdout: sandboxResult.stdout.slice(0, 2000),
      sandboxStderr: sandboxResult.stderr.slice(0, 1000),
      containerId: sandboxResult.containerId,
      sandboxDurationMs: sandboxResult.durationMs,
    },
    aiAnalysis: aiAnalysis ?? undefined,
    durationMs: Date.now() - startTime,
  };
}

// ── Content Analysis Strategy (for write/edit) ──────────────────────────

async function runContentAnalysis(
  request: LocalSimulationRequest,
): Promise<SimulationResult> {
  const startTime = Date.now();
  const { toolName, args, aiDescription } = request;

  const targetPath = String(args.path ?? args.file ?? args.filepath ?? '');
  const content = String(args.content ?? args.new_string ?? '');
  const statedIntent = aiDescription || `${toolName} ${targetPath}`;

  const aiAnalysis = await analyzeWithAI(
    buildContentAnalysisPrompt(),
    buildContentAnalysisUserMessage(statedIntent, targetPath, content),
  );

  const passed = aiAnalysis ? aiAnalysis.intentMatch : true;

  return {
    passed,
    strategy: 'CONTENT_ANALYSIS',
    summary: aiAnalysis
      ? (passed
        ? `Content analysis: matches intent — ${aiAnalysis.reasoning.slice(0, 200)}`
        : `Content analysis: MISMATCH — ${aiAnalysis.discrepancies.join('; ').slice(0, 200)}`)
      : 'Content analysis: AI unavailable, passing through',
    details: {
      targetPath,
      contentPreview: content.slice(0, 500),
      toolName,
    },
    aiAnalysis: aiAnalysis ?? undefined,
    durationMs: Date.now() - startTime,
  };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Simulate a structured/credential action (Layer 2 for structured_action / gateway).
 * Runs the command in a sandbox container, then AI verifies intent.
 */
export async function simulateAction(
  prisma: PrismaClient,
  request: SimulationRequest,
): Promise<SimulationResult> {
  await emitRunEvent(prisma, request.runId, 'simulation_start', {
    action: request.actionSpec.action,
    strategy: 'SANDBOX_EXEC',
  });

  const result = await runSandboxSimulation(prisma, request);

  await emitRunEvent(prisma, request.runId, 'simulation_complete', {
    action: request.actionSpec.action,
    strategy: result.strategy,
    passed: result.passed,
    summary: result.summary,
    durationMs: result.durationMs,
    intentMatch: result.aiAnalysis?.intentMatch,
    discrepancies: result.aiAnalysis?.discrepancies,
  });

  await persistEvent(prisma, {
    type: 'simulation.completed',
    data: {
      runId: request.runId,
      action: request.actionSpec.action,
      strategy: result.strategy,
      passed: result.passed,
    },
  });

  return result;
}

/**
 * Simulate a local tool call (Layer 2 for exec/write/edit when risk threshold triggers).
 * For exec: sandbox execution. For write/edit: content analysis.
 */
export async function simulateLocalAction(
  prisma: PrismaClient,
  request: LocalSimulationRequest,
): Promise<SimulationResult> {
  const { toolName, args, runId } = request;

  await emitRunEvent(prisma, runId, 'simulation_start', {
    toolName,
    strategy: toolName === 'exec' || toolName === 'process'
      ? 'SANDBOX_EXEC'
      : 'CONTENT_ANALYSIS',
  });

  let result: SimulationResult;

  if (toolName === 'exec' || toolName === 'process') {
    // Sandbox the command
    const command = String(args.command ?? args.cmd ?? '');
    result = await runSandboxSimulation(prisma, {
      actionSpec: { action: `local:${toolName}`, params: { command, ...args } },
      connectionId: '',
      runId,
      statedIntent: request.aiDescription || `Execute: ${command.slice(0, 100)}`,
    });
  } else if (toolName === 'web_fetch' || toolName === 'http') {
    // Sandbox as a curl command
    const url = String(args.url ?? '');
    const method = String(args.method ?? 'GET');
    const body = args.body ? `-d '${String(args.body).slice(0, 500)}'` : '';
    const curlCmd = `curl -s -X ${method} ${body} "${url}"`;
    result = await runSandboxSimulation(prisma, {
      actionSpec: { action: `local:${toolName}`, params: { command: curlCmd } },
      connectionId: '',
      runId,
      statedIntent: request.aiDescription || `HTTP ${method} ${url}`,
    });
  } else {
    // write/edit → content analysis (no container needed)
    result = await runContentAnalysis(request);
  }

  await emitRunEvent(prisma, runId, 'simulation_complete', {
    toolName,
    strategy: result.strategy,
    passed: result.passed,
    summary: result.summary,
    durationMs: result.durationMs,
    intentMatch: result.aiAnalysis?.intentMatch,
  });

  await persistEvent(prisma, {
    type: 'simulation.completed',
    data: {
      runId,
      action: `local:${toolName}`,
      strategy: result.strategy,
      passed: result.passed,
    },
  });

  return result;
}

/**
 * Check if simulation should trigger for a given risk tier and org threshold.
 */
export function shouldSimulate(
  riskTier: string,
  threshold: string,
  isCredentialAction: boolean,
): boolean {
  // Credential actions always get simulated
  if (isCredentialAction) return true;

  const tierOrder: Record<string, number> = {
    READ: 0,
    WRITE: 1,
    DESTRUCTIVE: 2,
  };

  const thresholdToMinTier: Record<string, number> = {
    critical_only: 3, // Nothing local triggers (only credential actions)
    high: 2,          // DESTRUCTIVE
    medium: 1,        // WRITE + DESTRUCTIVE
    all: 0,           // Everything
  };

  const actionLevel = tierOrder[riskTier] ?? 1;
  const minLevel = thresholdToMinTier[threshold] ?? 2;

  return actionLevel >= minLevel;
}
