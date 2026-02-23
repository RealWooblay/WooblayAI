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
  buildMcpResultVerificationPrompt,
  buildMcpResultVerificationUserMessage,
  buildMcpPreExecVerificationPrompt,
  buildMcpPreExecVerificationUserMessage,
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

// ── MCP Post-Execution Verification (L2 for MCP) ───────────────────────

export interface McpVerificationRequest {
  toolName: string;
  toolArgs: Record<string, unknown>;
  serverCommand: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface McpVerificationResult {
  passed: boolean;
  strategy: 'MCP_RESULT_VERIFICATION';
  summary: string;
  aiAnalysis?: AIIntentAnalysis;
  durationMs: number;
}

/**
 * Post-execution intent verification for MCP tool calls.
 *
 * Since MCP servers need real credentials + network, we can't sandbox them.
 * Instead, L2 runs AFTER L3: AI verifies the result matches the tool + args.
 *
 * This is the MCP equivalent of the sandbox simulation — it catches:
 *   - Tool returning data unrelated to its stated purpose
 *   - Evidence of credential exfiltration in the output
 *   - MCP server calling a different API than expected
 *   - Anomalous encoded payloads hiding exfiltrated secrets
 *
 * If verification fails, the result is still returned (execution already
 * happened), but an audit flag is raised and the verification result is
 * included in the response for the caller to act on.
 */
export async function verifyMcpToolResult(
  prisma: PrismaClient,
  request: McpVerificationRequest,
): Promise<McpVerificationResult> {
  const startTime = Date.now();

  const aiResult = await analyzeWithAI(
    buildMcpResultVerificationPrompt(),
    buildMcpResultVerificationUserMessage(
      request.toolName,
      request.toolArgs,
      request.serverCommand,
      request.stdout,
      request.exitCode,
      request.stderr,
    ),
  );

  const durationMs = Date.now() - startTime;

  if (!aiResult) {
    return {
      passed: true,
      strategy: 'MCP_RESULT_VERIFICATION',
      summary: 'AI verification unavailable — passed by default (no OpenAI key or AI error)',
      durationMs,
    };
  }

  await persistEvent(prisma, {
    type: 'mcp_verification.completed',
    data: {
      toolName: request.toolName,
      serverCommand: request.serverCommand,
      passed: aiResult.intentMatch,
      reasoning: aiResult.reasoning,
      discrepancies: aiResult.discrepancies,
      durationMs,
    },
  });

  return {
    passed: aiResult.intentMatch,
    strategy: 'MCP_RESULT_VERIFICATION',
    summary: aiResult.intentMatch
      ? `Verified: result matches expected behaviour of ${request.toolName}`
      : `MISMATCH: ${aiResult.reasoning}`,
    aiAnalysis: aiResult,
    durationMs,
  };
}

// ── MCP Pre-Execution Verification (L2 BEFORE credentials) ─────────────

export interface McpPreExecRequest {
  serverCommand: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  /** Env var names (NOT values) that will be injected */
  credentialEnvVars: string[];
}

export interface McpPreExecResult {
  safe: boolean;
  reasoning: string;
  threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  concerns: string[];
  durationMs: number;
}

/**
 * Pre-execution L2 verification for MCP tool calls.
 *
 * Runs BEFORE credentials are injected. Verifies that the server command,
 * tool name, arguments, and credential env var names form a safe combination.
 *
 * This is the primary defence against the main MCP threat: a malicious server
 * package that steals injected credentials. If this returns safe=false,
 * execution is BLOCKED and no credentials leave the vault.
 */
export async function verifyMcpPreExecution(
  prisma: PrismaClient,
  request: McpPreExecRequest,
): Promise<McpPreExecResult> {
  const startTime = Date.now();

  const aiResult = await analyzePreExec(
    buildMcpPreExecVerificationPrompt(),
    buildMcpPreExecVerificationUserMessage(
      request.serverCommand,
      request.toolName,
      request.toolArgs,
      request.credentialEnvVars,
    ),
  );

  const durationMs = Date.now() - startTime;

  if (!aiResult) {
    // No AI available — use rule-based fallback
    const ruleResult = ruleBasedMcpCheck(request);
    await persistEvent(prisma, {
      type: 'mcp_pre_verification.completed',
      data: {
        serverCommand: request.serverCommand,
        toolName: request.toolName,
        credentialEnvVars: request.credentialEnvVars,
        safe: ruleResult.safe,
        threatLevel: ruleResult.threatLevel,
        reasoning: ruleResult.reasoning,
        concerns: ruleResult.concerns,
        source: 'rules',
        durationMs,
      },
    });
    return { ...ruleResult, durationMs };
  }

  await persistEvent(prisma, {
    type: 'mcp_pre_verification.completed',
    data: {
      serverCommand: request.serverCommand,
      toolName: request.toolName,
      credentialEnvVars: request.credentialEnvVars,
      safe: aiResult.safe,
      threatLevel: aiResult.threatLevel,
      reasoning: aiResult.reasoning,
      concerns: aiResult.concerns,
      source: 'ai',
      durationMs,
    },
  });

  return {
    safe: aiResult.safe,
    reasoning: aiResult.reasoning,
    threatLevel: aiResult.threatLevel,
    concerns: aiResult.concerns,
    durationMs,
  };
}

/** AI pre-execution analysis — separate from the general analyzeWithAI to parse the different response shape. */
async function analyzePreExec(
  systemPrompt: string,
  userMessage: string,
): Promise<{ safe: boolean; reasoning: string; threatLevel: 'none' | 'low' | 'medium' | 'high' | 'critical'; concerns: string[] } | null> {
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
      safe: Boolean(result.safe),
      reasoning: String(result.reasoning ?? ''),
      threatLevel: ['none', 'low', 'medium', 'high', 'critical'].includes(result.threatLevel) ? result.threatLevel : 'medium',
      concerns: Array.isArray(result.concerns) ? result.concerns.map(String) : [],
    };
  } catch (err) {
    console.warn('[simulate] Pre-exec AI analysis failed:', err);
    return null;
  }
}

/** Rule-based fallback when AI is unavailable. */
function ruleBasedMcpCheck(request: McpPreExecRequest): Omit<McpPreExecResult, 'durationMs'> {
  const cmd = request.serverCommand.toLowerCase();
  const concerns: string[] = [];

  // Known official MCP packages
  const isOfficialMcp = cmd.includes('@modelcontextprotocol/');

  // Check credential-server alignment
  const hasGithubCreds = request.credentialEnvVars.some(v =>
    /github|gh_token/i.test(v),
  );
  const isGithubServer = cmd.includes('server-github');

  if (hasGithubCreds && !isGithubServer && !isOfficialMcp) {
    concerns.push('GitHub credentials being sent to non-GitHub server');
  }

  const hasAwsCreds = request.credentialEnvVars.some(v =>
    /aws/i.test(v),
  );
  if (hasAwsCreds && !cmd.includes('server-aws') && !isOfficialMcp) {
    concerns.push('AWS credentials being sent to non-AWS server');
  }

  // Unknown packages with any credentials
  if (!isOfficialMcp && request.credentialEnvVars.length > 0) {
    concerns.push(`Non-official MCP package receiving ${request.credentialEnvVars.length} credential(s)`);
  }

  // Suspicious tool names
  const suspiciousTools = ['shell', 'exec', 'eval', 'exfiltrate', 'upload', 'send'];
  if (suspiciousTools.some(s => request.toolName.toLowerCase().includes(s))) {
    concerns.push(`Suspicious tool name: ${request.toolName}`);
  }

  const safe = concerns.length === 0;
  const threatLevel = concerns.length === 0 ? 'none' as const
    : concerns.length === 1 ? 'low' as const
    : concerns.some(c => c.includes('credentials being sent')) ? 'high' as const
    : 'medium' as const;

  return {
    safe,
    reasoning: safe
      ? `Official MCP server with matching credentials for ${request.toolName}`
      : `Blocked: ${concerns.join('; ')}`,
    threatLevel,
    concerns,
  };
}
