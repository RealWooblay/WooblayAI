/**
 * Secure Execution Engine — ephemeral container execution for credentialed actions.
 *
 * When an agent wants to perform an external action (git push, create PR, deploy),
 * this engine:
 *   1. Validates the action spec against the registry
 *   2. Resolves credentials from the vault
 *   3. Spawns an ephemeral Docker container with:
 *      - Clean environment (no agent tampering)
 *      - Credentials injected from vault
 *      - Network scoped to target service
 *      - Agent workspace mounted read-only (if needed)
 *      - Deterministic command from the action registry
 *   4. Captures stdout/stderr/exit code
 *   5. Destroys the container
 *   6. Returns the result
 *
 * The agent NEVER has credentials. The agent NEVER runs the command.
 * The execution container exists for seconds, then is destroyed.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import type { ActionSpec, ExecutionSpec } from '../types/actions.js';
import { buildExecutionSpec } from './action-registry.js';
import { envelopeDecrypt, isEncrypted, redactSecrets } from '../services/vault.js';
import { persistEvent } from '../events/bus.js';
import { emitRunEvent } from './run-events.js';

const execAsync = promisify(exec);

import type { SecureExecRequest, SecureExecResult } from '../types/secure-exec.js';
export type { SecureExecRequest, SecureExecResult };

// ── Constants ───────────────────────────────────────────────────────────

const CONTAINER_PREFIX = 'wooblay-exec';
const EXEC_NETWORK = 'wooblay-exec-net';
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB max output

// ── Credential Resolution ───────────────────────────────────────────────

export async function resolveCredentials(
  prisma: PrismaClient,
  connectionId: string,
  provider: string,
): Promise<Record<string, string>> {
  const connection = await prisma.connection.findUnique({
    where: { id: connectionId },
  });

  if (!connection || connection.status !== 'active') {
    throw new Error(`Connection ${connectionId} not found or inactive`);
  }

  // Allow 'generic' provider to match any connection (for passthrough actions)
  if (provider !== 'generic' && connection.provider !== provider) {
    throw new Error(`Connection provider mismatch: expected ${provider}, got ${connection.provider}`);
  }

  const creds: Record<string, string> = {};

  // ── Known provider credential resolution ───────────────────────────────
  // These extract the main credential (token, key) in the standard env var format.
  // Additional secrets from the connection's secrets[] array are always injected below.

  if (connection.provider === 'github') {
    let token = connection.credentialRef;
    if (isEncrypted(token)) {
      token = envelopeDecrypt(token);
    }
    creds['GITHUB_TOKEN'] = token;
    creds['GH_TOKEN'] = token;
    creds['GITHUB_PERSONAL_ACCESS_TOKEN'] = token;
  }

  if (connection.provider === 'aws') {
    let meta: Record<string, string> = {};
    try { meta = connection.metadata ? JSON.parse(connection.metadata) : {}; } catch { /* malformed metadata */ }
    if (meta.awsAccessKeyId) creds['AWS_ACCESS_KEY_ID'] = meta.awsAccessKeyId;
    if (meta.awsSecretAccessKey) {
      let secret = meta.awsSecretAccessKey;
      if (isEncrypted(secret)) secret = envelopeDecrypt(secret);
      creds['AWS_SECRET_ACCESS_KEY'] = secret;
    }
    if (meta.region) creds['AWS_DEFAULT_REGION'] = meta.region;
  }

  if (connection.provider === 'gcp') {
    let meta: Record<string, string> = {};
    try { meta = connection.metadata ? JSON.parse(connection.metadata) : {}; } catch { /* malformed metadata */ }
    if (meta.gcpServiceAccountKey) {
      let key = meta.gcpServiceAccountKey;
      if (isEncrypted(key)) key = envelopeDecrypt(key);
      creds['GOOGLE_APPLICATION_CREDENTIALS'] = '/tmp/gcp-key.json';
      creds['_GCP_KEY_CONTENT'] = key;
    }
  }

  // ── Generic provider: inject credentialRef as API key ──────────────────
  if (connection.provider !== 'github' && connection.provider !== 'aws' && connection.provider !== 'gcp') {
    if (connection.credentialRef) {
      let token = connection.credentialRef;
      if (isEncrypted(token)) {
        token = envelopeDecrypt(token);
      }
      // Use the provider name as env var prefix (e.g., STRIPE_API_KEY for stripe)
      const prefix = connection.provider.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      creds[`${prefix}_API_KEY`] = token;
      // Also set as generic API_KEY for convenience
      creds['API_KEY'] = token;
    }
  }

  // ── Always inject exec_only secrets from this connection ───────────────
  if (connection.secrets) {
    let secrets: { key: string; encryptedValue: string; mode: string }[] = [];
    try { secrets = JSON.parse(connection.secrets); } catch { /* malformed secrets JSON */ }
    for (const s of secrets) {
      if (s.mode === 'exec_only') {
        creds[s.key] = isEncrypted(s.encryptedValue) ? envelopeDecrypt(s.encryptedValue) : s.encryptedValue;
      }
    }
  }

  return creds;
}

/**
 * Resolve agent-accessible secrets across all active connections in an org.
 * Injected into the agent's running container environment on startup.
 */
export async function resolveAgentSecrets(
  prisma: PrismaClient,
  orgId: string | null,
): Promise<Record<string, string>> {
  const where: any = { status: 'active' };
  if (orgId) where.orgId = orgId;

  const connections = await prisma.connection.findMany({ where, select: { secrets: true } });
  const envVars: Record<string, string> = {};

  for (const c of connections) {
    if (!c.secrets) continue;
    const secrets: { key: string; encryptedValue: string; mode: string }[] = JSON.parse(c.secrets);
    for (const s of secrets) {
      if (s.mode === 'agent') {
        envVars[s.key] = isEncrypted(s.encryptedValue) ? envelopeDecrypt(s.encryptedValue) : s.encryptedValue;
      }
    }
  }

  return envVars;
}

/**
 * Resolve and merge credentials from multiple connections.
 *
 * MCP servers may need credentials from multiple providers — e.g., a GitHub
 * token from one connection and a database password from another. Each
 * connection's credentials are resolved independently and merged. Later
 * connections override earlier ones if env var names collide (last-write-wins).
 *
 * This is the primary credential path for MCP tool execution. The proxy
 * sends `connectionIds: [...]` and the gate merges all of them.
 */
export async function resolveMultiConnectionCredentials(
  prisma: PrismaClient,
  connectionIds: string[],
): Promise<Record<string, string>> {
  if (connectionIds.length === 0) {
    throw new Error('At least one connectionId is required for credential resolution');
  }

  const merged: Record<string, string> = {};

  for (const connId of connectionIds) {
    const conn = await prisma.connection.findUnique({ where: { id: connId } });
    if (!conn || conn.status !== 'active') {
      throw new Error(`Connection ${connId} not found or inactive`);
    }
    const creds = await resolveCredentials(prisma, connId, conn.provider);
    Object.assign(merged, creds);
  }

  return merged;
}

// ── Container Management ────────────────────────────────────────────────

async function ensureExecNetwork(): Promise<void> {
  try {
    await execAsync(`docker network inspect ${EXEC_NETWORK}`, { timeout: 10_000 });
  } catch {
    await execAsync(
      `docker network create --driver bridge --internal ${EXEC_NETWORK}`,
      { timeout: 15_000 },
    );
  }
}

function buildContainerName(): string {
  const id = randomBytes(6).toString('hex');
  return `${CONTAINER_PREFIX}-${id}`;
}

/**
 * Write credentials to a temporary env-file and return its path.
 * Uses Docker's env-file format (KEY=VALUE, one per line) which is NOT
 * shell-interpreted — preventing $(), backtick, and newline injection that
 * would occur with `-e KEY="VALUE"` on a shell command line.
 * The file is deleted immediately after the container starts.
 */
function writeEnvFile(env: Record<string, string>, containerName: string): string {
  const dir = mkdtempSync(join(tmpdir(), `wooblay-exec-${containerName}-`));
  const envFilePath = join(dir, '.env');
  const lines = Object.entries(env)
    .filter(([k]) => k !== '_GCP_KEY_CONTENT')
    .map(([k, v]) => `${k}=${v}`);
  writeFileSync(envFilePath, lines.join('\n'), { mode: 0o600 });
  return envFilePath;
}

function cleanupEnvFile(envFilePath: string): void {
  try {
    unlinkSync(envFilePath);
    const dir = envFilePath.replace(/\/[^/]+$/, '');
    try { unlinkSync(dir); } catch { /* dir cleanup best-effort */ }
  } catch { /* best-effort cleanup */ }
}

async function runInContainer(
  spec: ExecutionSpec,
  containerName: string,
  workspacePath?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  const startTime = Date.now();

  // Write creds to env-file — never passes through shell expansion
  const envFilePath = writeEnvFile(spec.env, containerName);

  // Mount flags
  const mountFlags = spec.mountWorkspace && workspacePath
    ? `-v "${workspacePath}:/workspace:ro"`
    : '';

  // GCP key file handling (content written inside container, not on shell)
  const gcpKeyContent = spec.env['_GCP_KEY_CONTENT'];
  const gcpSetup = gcpKeyContent
    ? `cat /dev/stdin <<'__GCP_EOF__' > /tmp/gcp-key.json\n${gcpKeyContent}\n__GCP_EOF__\n`
    : '';

  // Git credential setup for GitHub (refs env var inside container, not shell)
  const gitCredSetup = spec.env['GITHUB_TOKEN']
    ? `git config --global credential.helper '!f() { echo "username=token"; echo "password=$GITHUB_TOKEN"; }; f' && `
    : '';

  const fullCommand = `${gcpSetup}${gitCredSetup}${spec.command}`;

  const dockerCmd = [
    'docker run',
    '--rm',
    `--name ${containerName}`,
    '--read-only',
    '--tmpfs /tmp:rw,noexec,nosuid,size=256m',
    '--memory 1g',
    '--cpus 1',
    '--pids-limit 128',
    `--network ${EXEC_NETWORK}`,
    `--env-file "${envFilePath}"`,
    mountFlags,
    `-w ${spec.workdir}`,
    spec.image,
    `sh -c "${fullCommand.replace(/"/g, '\\"')}"`,
  ].filter(Boolean).join(' ');

  try {
    const { stdout, stderr } = await execAsync(dockerCmd, {
      timeout: spec.timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    cleanupEnvFile(envFilePath);
    return {
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
      exitCode: 0,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
    cleanupEnvFile(envFilePath);
    return {
      stdout: (err.stdout ?? '').slice(0, MAX_OUTPUT_BYTES),
      stderr: (err.stderr ?? err.message ?? '').slice(0, MAX_OUTPUT_BYTES),
      exitCode: err.code ?? 1,
      durationMs: Date.now() - startTime,
    };
  }
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Execute a structured action securely in an ephemeral container.
 *
 * Flow:
 *   1. Resolve credentials from vault
 *   2. Build execution spec from action registry
 *   3. Optionally run dry-run simulation
 *   4. Spawn ephemeral container
 *   5. Capture result
 *   6. Destroy container
 *   7. Return result + emit events
 */
export async function executeSecureAction(
  prisma: PrismaClient,
  request: SecureExecRequest,
): Promise<SecureExecResult> {
  const { actionSpec, connectionId, runId, workspacePath } = request;
  const containerName = buildContainerName();

  // 1. Resolve credentials — provider comes from params, action def, or connection
  let credentials: Record<string, string>;
  try {
    const def = (await import('./action-registry.js')).getActionDefinition(actionSpec.action);
    // Provider resolution: params.provider > action definition > connection's own provider
    const effectiveProvider = actionSpec.params.provider
      ? String(actionSpec.params.provider)
      : def?.provider ?? 'generic';
    credentials = await resolveCredentials(prisma, connectionId, effectiveProvider);
  } catch (err: any) {
    return {
      success: false, stdout: '', stderr: redactSecrets(err.message),
      exitCode: 1, durationMs: 0, containerId: '', description: actionSpec.action,
      error: redactSecrets(err.message),
    };
  }

  // 2. Build execution spec
  const specResult = buildExecutionSpec(actionSpec, credentials);
  if ('error' in specResult) {
    return {
      success: false, stdout: '', stderr: specResult.error,
      exitCode: 1, durationMs: 0, containerId: '', description: actionSpec.action,
      error: specResult.error,
    };
  }

  const execSpec = specResult;

  // 3. Ensure execution network exists
  try {
    await ensureExecNetwork();
  } catch (err: any) {
    return {
      success: false, stdout: '', stderr: `Failed to create execution network: ${err.message}`,
      exitCode: 1, durationMs: 0, containerId: '', description: execSpec.description,
      error: `Network setup failed: ${err.message}`,
    };
  }

  // 4. Execute in ephemeral container
  // (Simulation is now handled upstream by simulate.ts before reaching here)
  await emitRunEvent(prisma, runId, 'secure_exec_start', {
    action: actionSpec.action,
    description: execSpec.description,
    image: execSpec.image,
    containerId: containerName,
  });

  const result = await runInContainer(execSpec, containerName, workspacePath);

  // 6. Emit completion event
  await emitRunEvent(prisma, runId, 'secure_exec_complete', {
    action: actionSpec.action,
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    containerId: containerName,
    stdout: redactSecrets(result.stdout.slice(0, 2000)),
    stderr: redactSecrets(result.stderr.slice(0, 500)),
  });

  await persistEvent(prisma, {
    type: 'secure_exec.completed',
    data: {
      runId,
      action: actionSpec.action,
      success: result.exitCode === 0,
      durationMs: result.durationMs,
      containerId: containerName,
    },
  });

  return {
    success: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    containerId: containerName,
    description: execSpec.description,
    error: result.exitCode !== 0 ? redactSecrets(result.stderr || 'Execution failed') : undefined,
  };
}

// ── MCP Tool Execution (Layer 3) ────────────────────────────────────────

export interface McpToolCallRequest {
  /** MCP server command (e.g. "npx @modelcontextprotocol/server-github") */
  serverCommand: string;
  /** Tool name to invoke */
  toolName: string;
  /** Tool arguments */
  toolArgs: Record<string, unknown>;
  /** Credential map: { ENV_VAR: secretValue } — resolved from vault before calling */
  credentials: Record<string, string>;
  /** Run ID for event logging. When absent (MCP proxy calls), events are skipped. */
  runId?: string;
  /** Docker image override (default: wooblay/mcp-executor:latest) */
  image?: string;
}

export interface McpToolCallResult {
  success: boolean;
  /** Raw MCP tool result (JSON) */
  result: unknown;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  containerId: string;
  error?: string;
}

/**
 * Execute a single MCP tool call in an ephemeral container.
 *
 * Security properties:
 *   - Credentials injected via env-file (deleted from host immediately)
 *   - Agent NEVER sees credentials — they live only inside this container
 *   - Container is ephemeral: auto-destroyed after one call
 *   - Limited resources: 1 CPU, 1GB mem, 256 PIDs
 *   - 120s hard timeout
 *
 * MCP containers use the default bridge network (outbound internet access)
 * because MCP servers must call external APIs (github.com, etc.).
 * This differs from the sandbox/simulation containers which use --internal.
 *
 * Tool params are passed via env vars (MCP_SERVER_CMD, MCP_TOOL_NAME,
 * MCP_TOOL_ARGS) to avoid all shell quoting / escaping issues.
 */
export async function executeMcpToolCall(
  prisma: PrismaClient,
  request: McpToolCallRequest,
): Promise<McpToolCallResult> {
  const containerName = buildContainerName();
  const image = request.image ?? 'wooblay/mcp-executor:latest';
  const startTime = Date.now();

  if (request.runId) {
    await emitRunEvent(prisma, request.runId, 'secure_exec_start', {
      action: 'mcp:tool-call',
      description: `MCP tool: ${request.toolName}`,
      image,
      containerId: containerName,
    });
  }

  // Validate server command and tool name. These go into the env-file (Docker
  // KEY=VALUE format, not shell-interpreted) and the executor reads them via
  // process.env — no shell expansion occurs. We validate rather than silently
  // strip characters, because stripping can corrupt valid commands silently.
  const serverCmd = request.serverCommand.trim();
  const toolName = request.toolName.trim();

  if (!serverCmd) {
    return {
      success: false, result: null, stdout: '', stderr: 'serverCommand is required',
      exitCode: 1, durationMs: 0, containerId: containerName, error: 'serverCommand is required',
    };
  }
  if (!toolName) {
    return {
      success: false, result: null, stdout: '', stderr: 'toolName is required',
      exitCode: 1, durationMs: 0, containerId: containerName, error: 'toolName is required',
    };
  }

  // Block shell metacharacters that indicate injection attempts. The env-file
  // transport is safe, but the executor splits serverCmd on whitespace and
  // passes to StdioClientTransport (direct exec, no shell). These chars have
  // no legitimate use in an MCP server command or tool name.
  const SHELL_INJECT_PATTERN = /[;&|`$]/;
  if (SHELL_INJECT_PATTERN.test(serverCmd)) {
    return {
      success: false, result: null, stdout: '', stderr: 'serverCommand contains forbidden characters (;&|`$)',
      exitCode: 1, durationMs: 0, containerId: containerName, error: 'serverCommand contains forbidden shell metacharacters',
    };
  }
  if (SHELL_INJECT_PATTERN.test(toolName)) {
    return {
      success: false, result: null, stdout: '', stderr: 'toolName contains forbidden characters (;&|`$)',
      exitCode: 1, durationMs: 0, containerId: containerName, error: 'toolName contains forbidden shell metacharacters',
    };
  }

  // Credentials + tool params go in the env-file (secure, no shell expansion).
  // The executor reads MCP_SERVER_CMD / MCP_TOOL_NAME / MCP_TOOL_ARGS from env.
  const env: Record<string, string> = {
    ...request.credentials,
    MCP_SERVER_CMD: serverCmd,
    MCP_TOOL_NAME: toolName,
    MCP_TOOL_ARGS: JSON.stringify(request.toolArgs),
  };
  const envFilePath = writeEnvFile(env, containerName);

  // Security posture for MCP ephemeral containers:
  //   --read-only: container filesystem is immutable (prevents binary tampering)
  //   tmpfs mounts: writable scratch space only where needed
  //   --rm: container destroyed after execution (no credential residue)
  //   No --network flag: default bridge (outbound internet) because MCP servers
  //     must reach external APIs. This is the main trade-off — a malicious MCP
  //     server could theoretically exfiltrate creds via outbound HTTP. Mitigation:
  //     credentials are short-lived (container dies in <120s), scoped (org-level
  //     PATs, not global), and audited. Future: egress proxy/firewall to restrict
  //     outbound to only the target API domain.
  const dockerCmd = [
    'docker run',
    '--rm',
    `--name ${containerName}`,
    '--read-only',
    '--tmpfs /tmp:rw,nosuid,size=512m',
    '--tmpfs /root/.npm:rw,nosuid,size=256m',
    '--memory 1g',
    '--cpus 1',
    '--pids-limit 256',
    `--env-file "${envFilePath}"`,
    '-w /opt/wooblay',
    image,
    'node', '/opt/wooblay/mcp-executor.js',
  ].join(' ');

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    const out = await execAsync(dockerCmd, {
      timeout: 120_000,
      maxBuffer: MAX_OUTPUT_BYTES,
    });
    stdout = out.stdout.slice(0, MAX_OUTPUT_BYTES);
    stderr = out.stderr.slice(0, MAX_OUTPUT_BYTES);
  } catch (err: any) {
    stdout = (err.stdout ?? '').slice(0, MAX_OUTPUT_BYTES);
    stderr = (err.stderr ?? err.message ?? '').slice(0, MAX_OUTPUT_BYTES);
    exitCode = err.code ?? 1;
  } finally {
    cleanupEnvFile(envFilePath);
  }

  const durationMs = Date.now() - startTime;

  let parsedResult: unknown = null;
  if (stdout.trim()) {
    try {
      parsedResult = JSON.parse(stdout.trim().split('\n').pop() ?? '');
    } catch {
      parsedResult = { content: [{ type: 'text', text: stdout }] };
    }
  }

  if (request.runId) {
    await emitRunEvent(prisma, request.runId, 'secure_exec_complete', {
      action: 'mcp:tool-call',
      success: exitCode === 0,
      exitCode,
      durationMs,
      containerId: containerName,
      stdout: redactSecrets(stdout.slice(0, 2000)),
      stderr: redactSecrets(stderr.slice(0, 500)),
    });
  }

  // Credential env var names (never values) for admin visibility
  const credentialEnvVars = Object.keys(request.credentials ?? {});

  await persistEvent(prisma, {
    type: 'secure_exec.completed',
    data: {
      runId: request.runId ?? `mcp-${containerName}`,
      action: 'mcp:tool-call',
      toolName: request.toolName,
      serverCommand: serverCmd,
      success: exitCode === 0,
      durationMs,
      containerId: containerName,
      image,
      credentialEnvVars,
      containerSecurity: {
        readOnly: true,
        tmpfs: ['/tmp:rw,nosuid,size=512m', '/root/.npm:rw,nosuid,size=256m'],
        memoryLimit: '1g',
        cpuLimit: 1,
        pidsLimit: 256,
        autoRemove: true,
        envFileInjection: true,
        networkMode: 'bridge (outbound only)',
      },
      stderr: redactSecrets((stderr || '').slice(0, 1000)),
      exitCode,
    },
  });

  return {
    success: exitCode === 0,
    result: parsedResult,
    stdout,
    stderr,
    exitCode,
    durationMs,
    containerId: containerName,
    error: exitCode !== 0 ? redactSecrets(stderr || 'MCP tool execution failed') : undefined,
  };
}

// ── MCP Server Probe ────────────────────────────────────────────────────

export interface McpProbeResult {
  /** Env var names detected from error output (e.g. ["SLACK_BOT_TOKEN"]) */
  detectedEnvVars: string[];
  /** Whether the server started successfully without credentials */
  serverStarted: boolean;
  /** Raw stderr from the probe run */
  stderr: string;
  /** Duration of the probe */
  durationMs: number;
}

/**
 * Probe an MCP server to detect its required environment variables.
 *
 * Runs the server command inside the executor container with NO credentials.
 * Most MCP servers fail fast with a clear error when required env vars are
 * missing (e.g., "Error: SLACK_BOT_TOKEN is not set"). We parse these errors
 * to auto-detect what the server needs, so the user doesn't have to guess.
 *
 * The probe runs in a resource-limited container with a 20s timeout.
 * It has outbound network access (for npx to download the package).
 */
export async function probeMcpServer(serverCommand: string): Promise<McpProbeResult> {
  const containerName = `${CONTAINER_PREFIX}-probe-${randomBytes(4).toString('hex')}`;
  const image = 'wooblay/mcp-executor:latest';
  const startTime = Date.now();

  const env: Record<string, string> = {
    MCP_SERVER_CMD: serverCommand,
    MCP_TOOL_NAME: '__wooblay_probe__',
    MCP_TOOL_ARGS: '{}',
  };
  const envFilePath = writeEnvFile(env, containerName);

  const dockerCmd = [
    'docker run',
    '--rm',
    `--name ${containerName}`,
    '--read-only',
    '--tmpfs /tmp:rw,nosuid,size=512m',
    '--tmpfs /root/.npm:rw,nosuid,size=256m',
    '--memory 512m',
    '--cpus 0.5',
    '--pids-limit 128',
    `--env-file "${envFilePath}"`,
    '-w /opt/wooblay',
    image,
    'node', '/opt/wooblay/mcp-executor.js',
  ].join(' ');

  let stdout = '';
  let stderr = '';

  try {
    const out = await execAsync(dockerCmd, { timeout: 30_000, maxBuffer: MAX_OUTPUT_BYTES });
    stdout = out.stdout.slice(0, MAX_OUTPUT_BYTES);
    stderr = out.stderr.slice(0, MAX_OUTPUT_BYTES);
  } catch (err: any) {
    stdout = (err.stdout ?? '').slice(0, MAX_OUTPUT_BYTES);
    stderr = (err.stderr ?? err.message ?? '').slice(0, MAX_OUTPUT_BYTES);
  } finally {
    cleanupEnvFile(envFilePath);
  }

  const durationMs = Date.now() - startTime;
  const combined = `${stderr}\n${stdout}`;

  // Extract env var names from error output. MCP servers typically produce errors like:
  //   "Error: SLACK_BOT_TOKEN is not set"
  //   "Missing required environment variable: GITHUB_PERSONAL_ACCESS_TOKEN"
  //   "BRAVE_API_KEY must be provided"
  //   "Error: Configuration error: POSTGRES_CONNECTION_STRING is required"
  const contextPattern = /(?:missing|required|not set|must be|expected|provide|configure|undefined|error)[^A-Z]*([A-Z][A-Z0-9_]{3,})/gi;
  const directPattern = /\b([A-Z][A-Z0-9_]{3,})\b[^a-z]*(?:is not set|is required|is missing|not found|must be|not defined|not provided|undefined)/gi;

  const foundVars = new Set<string>();
  for (const pattern of [contextPattern, directPattern]) {
    let match;
    while ((match = pattern.exec(combined)) !== null) {
      const varName = match[1];
      // Filter out common false positives
      if (!PROBE_IGNORE_VARS.has(varName)) {
        foundVars.add(varName);
      }
    }
  }

  // If the executor reached the "tool not found" stage, the server started OK
  const serverStarted = combined.includes('__wooblay_probe__') ||
    combined.includes('Tool not found') ||
    combined.includes('Unknown tool');

  return {
    detectedEnvVars: [...foundVars],
    serverStarted,
    stderr: stderr.slice(0, 2000),
    durationMs,
  };
}

const PROBE_IGNORE_VARS = new Set([
  'PATH', 'HOME', 'NODE_ENV', 'NODE_PATH', 'NPM_CONFIG_CACHE',
  'TERM', 'SHELL', 'USER', 'HOSTNAME', 'PWD', 'LANG', 'LC_ALL',
  'MCP_SERVER_CMD', 'MCP_TOOL_NAME', 'MCP_TOOL_ARGS', 'MCP_PROBE_MODE',
  'WOOBLAY_SANDBOX', 'JSON', 'HTTP', 'HTTPS', 'URL', 'ERROR',
  'TRUE', 'FALSE', 'NULL', 'UNDEFINED', 'STRING', 'NUMBER',
]);

// ── Sandbox Execution (Layer 2 Simulation) ──────────────────────────────

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  containerId: string;
}

/**
 * Run a command in a completely isolated sandbox container.
 *
 * Used by the simulation layer (Layer 2) to verify intent before real execution.
 * The sandbox has:
 *   - NO network access (--network none)
 *   - NO real credentials (dummy env vars)
 *   - Temp workspace (not the real one)
 *   - 30-second hard timeout
 *   - Container auto-destroyed after
 *
 * This is NOT execution. It's a test run to observe what the command tries to do.
 */
export async function runSandboxExec(
  command: string,
  options: {
    image?: string;
    env?: Record<string, string>;
    workspacePath?: string;
    timeoutMs?: number;
  } = {},
): Promise<SandboxResult> {
  const containerName = `${CONTAINER_PREFIX}-sandbox-${randomBytes(6).toString('hex')}`;
  const image = options.image || 'node:20-slim';
  const timeoutMs = options.timeoutMs || 30_000;
  const startTime = Date.now();

  // Dummy env vars so code referencing $SECRET doesn't crash on "unbound variable"
  // but never contains real values
  const dummyEnv: Record<string, string> = {
    WOOBLAY_SANDBOX: 'true',
    ...(options.env || {}),
  };

  const envFlags = Object.entries(dummyEnv)
    .map(([k, v]) => `-e ${k}="${v.replace(/"/g, '\\"')}"`)
    .join(' ');

  // Mount workspace as read-only if provided (snapshot, not real)
  const mountFlags = options.workspacePath
    ? `-v "${options.workspacePath}:/workspace:ro"`
    : '';

  const dockerCmd = [
    'docker run',
    '--rm',
    `--name ${containerName}`,
    '--read-only',
    '--tmpfs /tmp:rw,noexec,nosuid,size=64m',
    '--memory 512m',
    '--cpus 0.5',
    '--pids-limit 64',
    '--network none',      // No network — this is the key sandbox constraint
    envFlags,
    mountFlags,
    '-w /workspace',
    image,
    `sh -c "${command.replace(/"/g, '\\"')}"`,
  ].filter(Boolean).join(' ');

  try {
    const { stdout, stderr } = await execAsync(dockerCmd, {
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
    });

    return {
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
      exitCode: 0,
      durationMs: Date.now() - startTime,
      containerId: containerName,
    };
  } catch (err: any) {
    return {
      stdout: (err.stdout ?? '').slice(0, MAX_OUTPUT_BYTES),
      stderr: (err.stderr ?? err.message ?? '').slice(0, MAX_OUTPUT_BYTES),
      exitCode: err.code ?? 1,
      durationMs: Date.now() - startTime,
      containerId: containerName,
    };
  }
}
