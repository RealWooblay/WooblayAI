/**
 * Evidence Environment Pinning.
 *
 * Records the exact environment in which evidence was produced:
 * - Base image digest (not tag)
 * - OS version
 * - Toolchain versions (node, npm, git, python, etc.)
 * - Dependency lockfile hash
 * - Environment variable names hash (not values — those are secrets)
 * - Cache strategy
 *
 * This makes evidence reproducible: given the same environment manifest,
 * running the same recipe should produce the same result.
 */

import { createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrismaClient } from '@prisma/client';

const execAsync = promisify(exec);

import type { EnvironmentManifest } from '../types/evidence.js';
export type { EnvironmentManifest };

// ── Capture Environment ─────────────────────────────────────────────────

/**
 * Capture the current environment manifest.
 * Call this inside the evidence execution context (container or local).
 */
export async function captureEnvironment(
  workDir?: string,
  envVars?: Record<string, string>,
): Promise<EnvironmentManifest> {
  const toolchainVersions: Record<string, string> = {};

  // Capture toolchain versions
  const tools: [string, string][] = [
    ['node', 'node --version'],
    ['npm', 'npm --version'],
    ['git', 'git --version'],
    ['python', 'python3 --version 2>/dev/null || python --version 2>/dev/null || echo "not installed"'],
    ['docker', 'docker --version 2>/dev/null || echo "not installed"'],
  ];

  for (const [name, cmd] of tools) {
    try {
      const { stdout } = await execAsync(cmd, { timeout: 5_000, cwd: workDir });
      toolchainVersions[name] = stdout.trim();
    } catch {
      toolchainVersions[name] = 'unavailable';
    }
  }

  // OS version
  let osVersion: string | null = null;
  try {
    const { stdout } = await execAsync('cat /etc/os-release 2>/dev/null | head -2 || sw_vers 2>/dev/null || echo "unknown"', { timeout: 5_000 });
    osVersion = stdout.trim().slice(0, 200);
  } catch {
    osVersion = 'unknown';
  }

  // Base image digest
  let baseImageDigest: string | null = null;
  try {
    const { stdout } = await execAsync('cat /etc/image-digest 2>/dev/null || echo ""', { timeout: 5_000 });
    baseImageDigest = stdout.trim() || null;
  } catch {
    // Not in a Docker container with image digest
  }

  // Dependency lockfile hash
  let dependencyHash: string | null = null;
  if (workDir) {
    const lockfiles = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'requirements.txt', 'Pipfile.lock', 'go.sum'];
    for (const lockfile of lockfiles) {
      try {
        const { stdout } = await execAsync(`sha256sum ${lockfile} 2>/dev/null || shasum -a 256 ${lockfile} 2>/dev/null`, {
          timeout: 5_000,
          cwd: workDir,
        });
        dependencyHash = stdout.split(' ')[0] ?? null;
        break;
      } catch {
        // Try next lockfile
      }
    }
  }

  // Env var names hash (NOT values — those are secrets)
  let envVarHash: string | null = null;
  if (envVars) {
    const sortedNames = Object.keys(envVars).sort().join(',');
    envVarHash = createHash('sha256').update(sortedNames).digest('hex');
  }

  return {
    baseImageDigest,
    osVersion,
    toolchainVersions,
    dependencyHash,
    envVarHash,
    cacheStrategy: dependencyHash ? 'lockfile' : 'none',
  };
}

// ── Persist Environment ─────────────────────────────────────────────────

export async function persistEnvironment(
  prisma: PrismaClient,
  bundleId: string,
  manifest: EnvironmentManifest,
): Promise<string> {
  const env = await prisma.evidenceEnvironment.create({
    data: {
      bundleId,
      baseImageDigest: manifest.baseImageDigest,
      osVersion: manifest.osVersion,
      toolchainVersions: JSON.stringify(manifest.toolchainVersions),
      dependencyHash: manifest.dependencyHash,
      envVarHash: manifest.envVarHash,
      cacheStrategy: manifest.cacheStrategy,
    },
  });
  return env.id;
}
