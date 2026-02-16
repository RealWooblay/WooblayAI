/**
 * Run Recovery — distributed locks, heartbeats, and reaper.
 *
 * Ensures runs don't get wedged on server restart or crash.
 *
 * Lock protocol:
 * 1. Before processing a run, acquire lock: set lockedBy + lockedAt
 * 2. While processing, send heartbeats every HEARTBEAT_INTERVAL
 * 3. On completion, release lock
 * 4. Reaper runs periodically: any run with stale heartbeat gets reclaimed
 *
 * Server identity: hostname + pid + random suffix (unique per process).
 */

import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import type { PrismaClient, Run as PrismaRun } from '@prisma/client';
import { emitRunEvent } from './run-events.js';

// ── Constants ───────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 15_000; // 15 seconds
const HEARTBEAT_STALE_MS = 60_000; // 1 minute — reaper reclaims after this
const REAPER_INTERVAL_MS = 30_000; // 30 seconds

// ── Server Identity ─────────────────────────────────────────────────────

const SERVER_ID = `${hostname()}-${process.pid}-${randomBytes(4).toString('hex')}`;

export function getServerId(): string {
  return SERVER_ID;
}

// ── Lock Acquisition ────────────────────────────────────────────────────

/**
 * Attempt to acquire a lock on a run. Returns true if successful.
 * Uses optimistic concurrency: only succeeds if run is currently unlocked.
 */
export async function acquireRunLock(
  prisma: PrismaClient,
  runId: string,
): Promise<boolean> {
  try {
    const now = new Date();

    // Atomic: only lock if currently unlocked or lock is stale
    const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_MS);

    const result = await prisma.run.updateMany({
      where: {
        id: runId,
        OR: [
          { lockedBy: null },
          { heartbeatAt: { lt: staleThreshold } },
        ],
      },
      data: {
        lockedBy: SERVER_ID,
        lockedAt: now,
        heartbeatAt: now,
      },
    });

    return result.count > 0;
  } catch {
    return false;
  }
}

/**
 * Release the lock on a run.
 */
export async function releaseRunLock(
  prisma: PrismaClient,
  runId: string,
): Promise<void> {
  await prisma.run.updateMany({
    where: { id: runId, lockedBy: SERVER_ID },
    data: { lockedBy: null, lockedAt: null, heartbeatAt: null },
  });
}

// ── Heartbeat ───────────────────────────────────────────────────────────

/**
 * Send a heartbeat for a locked run.
 * Call this periodically while processing a run.
 */
export async function heartbeat(
  prisma: PrismaClient,
  runId: string,
): Promise<boolean> {
  const result = await prisma.run.updateMany({
    where: { id: runId, lockedBy: SERVER_ID },
    data: { heartbeatAt: new Date() },
  });
  return result.count > 0;
}

/**
 * Create a heartbeat interval for a run. Returns a cleanup function.
 */
export function startHeartbeat(
  prisma: PrismaClient,
  runId: string,
): () => void {
  const interval = setInterval(async () => {
    const ok = await heartbeat(prisma, runId);
    if (!ok) {
      // Lost lock — some other server reclaimed this run
      clearInterval(interval);
    }
  }, HEARTBEAT_INTERVAL_MS);

  return () => clearInterval(interval);
}

// ── Reaper ──────────────────────────────────────────────────────────────

/**
 * Reap stale runs — reclaim runs with expired heartbeats.
 * These are runs where the server crashed mid-processing.
 *
 * Strategy:
 * - If run was 'running' → transition to 'failed' (operator can retry)
 * - If run was 'scheduled' → release lock so scheduler picks it up again
 * - Log the recovery event
 */
export async function reapStaleRuns(prisma: PrismaClient): Promise<PrismaRun[]> {
  const staleThreshold = new Date(Date.now() - HEARTBEAT_STALE_MS);

  const staleRuns = await prisma.run.findMany({
    where: {
      lockedBy: { not: null },
      heartbeatAt: { lt: staleThreshold },
      status: { in: ['running', 'scheduled'] },
    },
  });

  const recovered: PrismaRun[] = [];

  for (const run of staleRuns) {
    try {
      if (run.status === 'running') {
        // Running with stale heartbeat → server crashed
        const updated = await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'failed',
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
            completedAt: new Date(),
          },
        });

        await emitRunEvent(prisma, run.id, 'error', {
          event: 'run_recovered',
          previousLock: run.lockedBy,
          previousHeartbeat: run.heartbeatAt?.toISOString(),
          resolution: 'failed',
          reason: 'Server heartbeat expired — run marked as failed for manual retry',
        });

        recovered.push(updated);
      } else if (run.status === 'scheduled') {
        // Scheduled but locked with stale heartbeat → release for rescheduling
        const updated = await prisma.run.update({
          where: { id: run.id },
          data: {
            status: 'pending',
            lockedBy: null,
            lockedAt: null,
            heartbeatAt: null,
          },
        });

        await emitRunEvent(prisma, run.id, 'state_change', {
          from: 'scheduled',
          to: 'pending',
          reason: 'Lock reclaimed by reaper — rescheduling',
        });

        recovered.push(updated);
      }
    } catch {
      // Skip runs that can't be recovered (already in terminal state, etc.)
    }
  }

  return recovered;
}

// ── Reaper Process ──────────────────────────────────────────────────────

let reaperInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start the reaper process. Call once on server startup.
 */
export function startReaper(prisma: PrismaClient): void {
  if (reaperInterval) return;

  reaperInterval = setInterval(async () => {
    try {
      const recovered = await reapStaleRuns(prisma);
      if (recovered.length > 0) {
        console.log(`[reaper] Recovered ${recovered.length} stale run(s): ${recovered.map((r) => r.id.slice(0, 12)).join(', ')}`);
      }
    } catch (err) {
      console.error('[reaper] Error:', err);
    }
  }, REAPER_INTERVAL_MS);
}

/**
 * Stop the reaper process.
 */
export function stopReaper(): void {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = null;
  }
}
