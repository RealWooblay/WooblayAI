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

async function resolveCredentials(
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
  }

  if (connection.provider === 'aws') {
    const meta = connection.metadata ? JSON.parse(connection.metadata) : {};
    if (meta.awsAccessKeyId) creds['AWS_ACCESS_KEY_ID'] = meta.awsAccessKeyId;
    if (meta.awsSecretAccessKey) {
      let secret = meta.awsSecretAccessKey;
      if (isEncrypted(secret)) secret = envelopeDecrypt(secret);
      creds['AWS_SECRET_ACCESS_KEY'] = secret;
    }
    if (meta.region) creds['AWS_DEFAULT_REGION'] = meta.region;
  }

  if (connection.provider === 'gcp') {
    const meta = connection.metadata ? JSON.parse(connection.metadata) : {};
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
    const secrets: { key: string; encryptedValue: string; mode: string }[] = JSON.parse(connection.secrets);
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

async function runInContainer(
  spec: ExecutionSpec,
  containerName: string,
  workspacePath?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number; durationMs: number }> {
  const startTime = Date.now();

  // Build environment flags
  const envFlags = Object.entries(spec.env)
    .filter(([k]) => k !== '_GCP_KEY_CONTENT') // Handle GCP key separately
    .map(([k, v]) => `-e ${k}="${v.replace(/"/g, '\\"')}"`)
    .join(' ');

  // Mount flags
  const mountFlags = spec.mountWorkspace && workspacePath
    ? `-v "${workspacePath}:/workspace:ro"`
    : '';

  // GCP key file handling
  const gcpKeyContent = spec.env['_GCP_KEY_CONTENT'];
  const gcpSetup = gcpKeyContent
    ? `echo '${gcpKeyContent.replace(/'/g, "\\'")}' > /tmp/gcp-key.json && `
    : '';

  // Git credential setup for GitHub
  const gitCredSetup = spec.env['GITHUB_TOKEN']
    ? `git config --global credential.helper '!f() { echo "username=token"; echo "password=$GITHUB_TOKEN"; }; f' && `
    : '';

  const fullCommand = `${gcpSetup}${gitCredSetup}${spec.command}`;

  // Build docker run command
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
    envFlags,
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

    return {
      stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
      stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
      exitCode: 0,
      durationMs: Date.now() - startTime,
    };
  } catch (err: any) {
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
