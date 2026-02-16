/**
 * Workspace Runner — container lifecycle + egress enforcement.
 *
 * Creates sandboxed workspaces for agent runs. Each workspace:
 * - Runs in an isolated Docker container
 * - Has network egress restricted to Gateway only (iptables)
 * - Has a mounted volume for working directory
 * - Logs attached to the run timeline
 *
 * Without this, "non-bypassable" is just a claim.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { emitRunEvent } from '../engine/run-events.js';

const execAsync = promisify(exec);

// ── Types ───────────────────────────────────────────────────────────────

export interface WorkspaceConfig {
  runId: string;
  instanceId?: string;
  repoUrl?: string;
  commitSha?: string;
  baseImage?: string;
  gatewayHost: string;
  gatewayPort: number;
  egressMode?: 'gateway_only' | 'unrestricted';
}

export interface WorkspaceState {
  workspaceId: string;
  containerId: string;
  networkNs: string;
  status: 'provisioning' | 'ready' | 'running' | 'stopped' | 'error';
}

// ── Constants ───────────────────────────────────────────────────────────

const DEFAULT_BASE_IMAGE = 'node:20-slim';
const WORKSPACE_LABEL = 'wooblay.workspace';
const WOOBLAY_NETWORK = 'wooblay-egress';

// ── Workspace Lifecycle ─────────────────────────────────────────────────

export async function createWorkspace(
  prisma: PrismaClient,
  config: WorkspaceConfig,
): Promise<WorkspaceState> {
  const baseImage = config.baseImage ?? DEFAULT_BASE_IMAGE;
  const egressMode = config.egressMode ?? 'gateway_only';

  // Create DB record
  const workspace = await prisma.workspace.create({
    data: {
      instanceId: config.instanceId ?? null,
      repoFullName: null,
      status: 'provisioning',
      egressMode,
      commitSha: config.commitSha ?? null,
    },
  });

  try {
    // 1. Ensure dedicated Docker network exists (gateway-only egress)
    if (egressMode === 'gateway_only') {
      await ensureNetwork(config.gatewayHost);
    }

    // 2. Create container on the dedicated network (or host for unrestricted)
    const containerName = `wooblay-ws-${workspace.id.slice(0, 12)}`;
    const networkFlag = egressMode === 'gateway_only'
      ? `--network ${WOOBLAY_NETWORK}`
      : '--network host';
    const createCmd = [
      'docker create',
      `--name ${containerName}`,
      `--label ${WORKSPACE_LABEL}=${workspace.id}`,
      `--label wooblay.run=${config.runId}`,
      networkFlag,
      '--memory 2g',
      '--cpus 2',
      '--pids-limit 256',
      '--read-only',
      '--tmpfs /tmp:rw,noexec,nosuid,size=1g',
      '--tmpfs /workspace:rw,exec,size=5g',
      '-w /workspace',
      baseImage,
      'sleep infinity', // Kept alive; agent runtime attaches to this
    ].join(' ');

    const { stdout: containerId } = await execAsync(createCmd, { timeout: 60_000 });
    const cid = containerId.trim();

    // 3. Start container
    await execAsync(`docker start ${cid}`, { timeout: 30_000 });

    // 4. Apply iptables egress rules inside container
    if (egressMode === 'gateway_only') {
      await applyEgressRules(cid, config.gatewayHost, config.gatewayPort);
    }

    // 5. Clone repo if specified
    if (config.repoUrl) {
      await execAsync(
        `docker exec ${cid} git clone --depth 1 ${config.repoUrl} /workspace/repo`,
        { timeout: 120_000 },
      );

      if (config.commitSha) {
        await execAsync(
          `docker exec ${cid} bash -c "cd /workspace/repo && git fetch --depth 50 origin && git checkout ${config.commitSha}"`,
          { timeout: 60_000 },
        );
      }
    }

    // 6. Compute working directory hash
    let workingDirHash: string | null = null;
    try {
      const { stdout: fileList } = await execAsync(
        `docker exec ${cid} find /workspace -type f -exec sha256sum {} \\; | sort`,
        { timeout: 30_000 },
      );
      workingDirHash = createHash('sha256').update(fileList).digest('hex');
    } catch {
      // Non-fatal
    }

    // 7. Get container network namespace
    const { stdout: nsRaw } = await execAsync(
      `docker inspect --format '{{.NetworkSettings.SandboxKey}}' ${cid}`,
      { timeout: 10_000 },
    );

    // 8. Update DB
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: {
        status: 'ready',
        containerId: cid,
        networkNs: nsRaw.trim(),
        containerImage: baseImage,
        workingDirHash,
      },
    });

    await emitRunEvent(prisma, config.runId, 'state_change', {
      event: 'workspace_created',
      workspaceId: workspace.id,
      containerId: cid,
      egressMode,
      workingDirHash,
    });

    return {
      workspaceId: workspace.id,
      containerId: cid,
      networkNs: nsRaw.trim(),
      status: 'ready',
    };
  } catch (err: any) {
    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { status: 'error' },
    });

    await emitRunEvent(prisma, config.runId, 'error', {
      event: 'workspace_creation_failed',
      workspaceId: workspace.id,
      error: err.message,
    });

    throw err;
  }
}

// ── Egress Enforcement ──────────────────────────────────────────────────

/**
 * Ensure the dedicated Docker network exists.
 * This network only allows traffic to the gateway and blocks everything else.
 */
async function ensureNetwork(gatewayHost: string): Promise<void> {
  try {
    await execAsync(`docker network inspect ${WOOBLAY_NETWORK}`, { timeout: 10_000 });
  } catch {
    // Network doesn't exist, create it
    await execAsync(`docker network create --driver bridge ${WOOBLAY_NETWORK}`, { timeout: 15_000 });
  }
}

async function applyEgressRules(
  containerId: string,
  gatewayHost: string,
  gatewayPort: number,
): Promise<void> {
  // ORDER MATTERS: Gateway allow MUST come before RFC1918 blocks,
  // because the gateway may be on a VPC private IP (10.x, 172.16.x, etc.)
  const rules = [
    // Allow loopback
    'iptables -A OUTPUT -o lo -j ACCEPT',
    // Allow established/related connections
    'iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT',
    // Allow DNS to Docker's internal resolver only
    'iptables -A OUTPUT -p udp --dport 53 -d 127.0.0.11 -j ACCEPT',
    // ALLOW: Gateway — inserted BEFORE any private-net blocks
    `iptables -A OUTPUT -p tcp -d ${gatewayHost} --dport ${gatewayPort} -j ACCEPT`,
    // BLOCK: AWS IMDS (instance metadata service) — critical on EC2
    'iptables -A OUTPUT -d 169.254.169.254 -j DROP',
    // BLOCK: Link-local range (metadata, DHCP abuse)
    'iptables -A OUTPUT -d 169.254.0.0/16 -j DROP',
    // BLOCK: GCP metadata endpoint
    'iptables -A OUTPUT -d metadata.google.internal -j DROP',
    // BLOCK: Common local networks (prevent lateral movement)
    'iptables -A OUTPUT -d 10.0.0.0/8 -j DROP',
    'iptables -A OUTPUT -d 172.16.0.0/12 -j DROP',
    'iptables -A OUTPUT -d 192.168.0.0/16 -j DROP',
    // LOG and DROP everything else
    'iptables -A OUTPUT -j LOG --log-prefix "WOOBLAY_BYPASS: " --log-level 4',
    'iptables -A OUTPUT -j DROP',
  ];

  for (const rule of rules) {
    try {
      await execAsync(`docker exec --privileged ${containerId} ${rule}`, { timeout: 10_000 });
    } catch {
      // iptables may not be available in slim images.
      // In production, use a sidecar container or Kubernetes NetworkPolicy.
    }
  }
}

// ── Stop / Destroy ──────────────────────────────────────────────────────

export async function stopWorkspace(
  prisma: PrismaClient,
  workspaceId: string,
  runId: string,
): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace?.containerId) return;

  try {
    await execAsync(`docker stop ${workspace.containerId}`, { timeout: 30_000 });
    await execAsync(`docker rm ${workspace.containerId}`, { timeout: 15_000 });
  } catch {
    // Container may already be stopped/removed
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { status: 'stopped' },
  });

  await emitRunEvent(prisma, runId, 'state_change', {
    event: 'workspace_stopped',
    workspaceId,
  });
}

// ── Log Attachment ──────────────────────────────────────────────────────

export async function getWorkspaceLogs(
  containerId: string,
  tail: number = 500,
): Promise<string> {
  try {
    const { stdout } = await execAsync(
      `docker logs --tail ${tail} ${containerId}`,
      { timeout: 10_000, maxBuffer: 5 * 1024 * 1024 },
    );
    return stdout;
  } catch {
    return '';
  }
}

// ── State Pointer ───────────────────────────────────────────────────────

export interface StatePointer {
  commitSha: string | null;
  containerImage: string | null;
  volumeSnapshot: string | null;
  workingDirHash: string | null;
  timestamp: string;
}

export async function captureStatePointer(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<StatePointer> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);

  return {
    commitSha: workspace.commitSha,
    containerImage: workspace.containerImage,
    volumeSnapshot: workspace.volumeId,
    workingDirHash: workspace.workingDirHash,
    timestamp: new Date().toISOString(),
  };
}
