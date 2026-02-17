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
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { ActionSpec, ExecutionSpec } from '../types/actions.js';
import { buildExecutionSpec, buildDryRunSpec } from './action-registry.js';
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

  if (connection.provider !== provider) {
    throw new Error(`Connection provider mismatch: expected ${provider}, got ${connection.provider}`);
  }

  const creds: Record<string, string> = {};

  if (provider === 'github') {
    let token = connection.credentialRef;
    if (isEncrypted(token)) {
      token = envelopeDecrypt(token);
    }
    creds['GITHUB_TOKEN'] = token;
    creds['GH_TOKEN'] = token;
  }

  if (provider === 'aws') {
    const meta = connection.metadata ? JSON.parse(connection.metadata) : {};
    if (meta.awsAccessKeyId) creds['AWS_ACCESS_KEY_ID'] = meta.awsAccessKeyId;
    if (meta.awsSecretAccessKey) {
      let secret = meta.awsSecretAccessKey;
      if (isEncrypted(secret)) secret = envelopeDecrypt(secret);
      creds['AWS_SECRET_ACCESS_KEY'] = secret;
    }
    if (meta.region) creds['AWS_DEFAULT_REGION'] = meta.region;
  }

  if (provider === 'gcp') {
    const meta = connection.metadata ? JSON.parse(connection.metadata) : {};
    if (meta.gcpServiceAccountKey) {
      let key = meta.gcpServiceAccountKey;
      if (isEncrypted(key)) key = envelopeDecrypt(key);
      creds['GOOGLE_APPLICATION_CREDENTIALS'] = '/tmp/gcp-key.json';
      creds['_GCP_KEY_CONTENT'] = key;
    }
  }

  // Inject exec_only secrets from this connection
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
 * Resolve all exec_only secrets across all active connections in an org.
 * Used by the generic exec:run action which may not know the provider upfront.
 */
export async function resolveAllExecSecrets(
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
      if (s.mode === 'exec_only') {
        envVars[s.key] = isEncrypted(s.encryptedValue) ? envelopeDecrypt(s.encryptedValue) : s.encryptedValue;
      }
    }
  }

  return envVars;
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
  const { actionSpec, connectionId, runId, workspacePath, simulate } = request;
  const containerName = buildContainerName();

  // 1. Resolve credentials
  let credentials: Record<string, string>;
  try {
    const def = (await import('./action-registry.js')).getActionDefinition(actionSpec.action);
    if (!def) {
      return {
        success: false, stdout: '', stderr: `Unknown action: ${actionSpec.action}`,
        exitCode: 1, durationMs: 0, containerId: '', description: actionSpec.action,
        error: `Unknown action: ${actionSpec.action}`,
      };
    }
    // For exec:run, use the provider from params; otherwise from the action definition
    const effectiveProvider = actionSpec.action === 'exec:run' && actionSpec.params.provider
      ? String(actionSpec.params.provider)
      : def.provider;
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

  // 4. Optional dry-run simulation
  let simulation: SecureExecResult['simulation'];
  if (simulate) {
    const dryRunSpec = buildDryRunSpec(actionSpec, credentials);
    if (dryRunSpec && !('error' in dryRunSpec)) {
      const simContainerName = `${containerName}-sim`;
      const simResult = await runInContainer(dryRunSpec, simContainerName, workspacePath);
      simulation = {
        passed: simResult.exitCode === 0,
        stdout: simResult.stdout,
        stderr: simResult.stderr,
        exitCode: simResult.exitCode,
      };

      await emitRunEvent(prisma, runId, 'secure_exec_simulation', {
        action: actionSpec.action,
        passed: simulation.passed,
        dryRunOutput: redactSecrets(simResult.stdout.slice(0, 2000)),
      });

      if (!simulation.passed) {
        return {
          success: false,
          stdout: simResult.stdout,
          stderr: simResult.stderr,
          exitCode: simResult.exitCode,
          durationMs: simResult.durationMs,
          containerId: simContainerName,
          description: execSpec.description,
          simulation,
          error: 'Dry-run simulation failed — action not executed',
        };
      }
    }
  }

  // 5. Execute in ephemeral container
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
    simulation,
    error: result.exitCode !== 0 ? redactSecrets(result.stderr || 'Execution failed') : undefined,
  };
}
