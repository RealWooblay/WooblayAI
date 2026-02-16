/**
 * Run Orchestrator — execution control plane.
 *
 * Manages the Run state machine, priority scheduling, preemption,
 * loop detection, kill switch, quarantine, and concurrency limits.
 */

import { createHash } from 'node:crypto';
import type { PrismaClient, Run as PrismaRun } from '@prisma/client';
import { RUN_TRANSITIONS, type RunStatus } from '@wooblay/types';
import { persistEvent } from '../events/bus.js';
import { emitRunEvent } from './run-events.js';

// ── Constants ───────────────────────────────────────────────────────────

const MAX_CONCURRENT_RUNS_PER_WORKSPACE = 3;
const MAX_GLOBAL_CONCURRENT_RUNS = 10;
const LOOP_DETECTION_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const LOOP_DETECTION_THRESHOLD = 5; // Same incident, 5 runs in 5 min = loop
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── Deterministic Run ID ────────────────────────────────────────────────

export function computeRunId(incidentId: string, attempt: number): string {
  return createHash('sha256')
    .update(`${incidentId}:${attempt}`)
    .digest('hex')
    .slice(0, 24); // 24-char hex for readability
}

// ── State Machine ───────────────────────────────────────────────────────

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  const allowed = RUN_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export async function transitionRun(
  prisma: PrismaClient,
  runId: string,
  to: RunStatus,
  reason?: string,
): Promise<PrismaRun> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });
  const from = run.status as RunStatus;

  if (!canTransition(from, to)) {
    throw new Error(`Invalid run transition: ${from} → ${to} (run ${runId})`);
  }

  const updateData: Record<string, unknown> = { status: to };
  if (to === 'running' && !run.startedAt) updateData.startedAt = new Date();
  if (to === 'paused') updateData.pausedAt = new Date();
  if (to === 'completed' || to === 'failed') updateData.completedAt = new Date();
  if (to === 'running' && run.pausedAt) updateData.pausedAt = null;

  const updated = await prisma.run.update({
    where: { id: runId },
    data: updateData,
  });

  // Record run event via normalized emitter
  await emitRunEvent(prisma, runId, 'state_change', { from, to, reason });

  await persistEvent(prisma, {
    type: 'run.state_changed',
    data: { runId, from, to, reason },
  });

  return updated;
}

// ── Run Creation ────────────────────────────────────────────────────────

export interface CreateRunInput {
  incidentId: string;
  priority?: string;
  workspaceId?: string;
  recipe?: string;
  budgetCents?: number;
  parentRunId?: string;
}

export async function createRun(
  prisma: PrismaClient,
  input: CreateRunInput,
): Promise<PrismaRun> {
  // Determine attempt number
  const existingRuns = await prisma.run.count({
    where: { incidentId: input.incidentId },
  });
  const attempt = existingRuns + 1;

  const id = computeRunId(input.incidentId, attempt);
  const priority = input.priority ?? 'P2';

  const run = await prisma.run.create({
    data: {
      id,
      incidentId: input.incidentId,
      priority,
      attempt,
      workspaceId: input.workspaceId ?? null,
      recipe: input.recipe ?? null,
      budgetCents: input.budgetCents ?? 1000,
      parentRunId: input.parentRunId ?? null,
      timeoutAt: new Date(Date.now() + DEFAULT_TIMEOUT_MS),
    },
  });

  // Record creation event via normalized emitter
  await emitRunEvent(prisma, id, 'state_change', { from: null, to: 'pending', reason: 'created' });

  await persistEvent(prisma, {
    type: 'run.created',
    data: { runId: id, incidentId: input.incidentId, priority },
  });

  // Update incident status to in_progress
  await prisma.incident.update({
    where: { id: input.incidentId },
    data: { status: 'in_progress' },
  });

  return run;
}

// ── Priority Scheduler ──────────────────────────────────────────────────

/** Get the next runs to schedule, ordered by priority then creation time. */
export async function getSchedulableRuns(
  prisma: PrismaClient,
): Promise<PrismaRun[]> {
  // Check global concurrency
  const activeCount = await prisma.run.count({
    where: { status: { in: ['running', 'scheduled'] } },
  });

  if (activeCount >= MAX_GLOBAL_CONCURRENT_RUNS) return [];

  const slotsAvailable = MAX_GLOBAL_CONCURRENT_RUNS - activeCount;

  // Fetch pending runs ordered by priority (P0 first) then creation time
  const pendingRuns = await prisma.run.findMany({
    where: { status: 'pending' },
    orderBy: [
      { priority: 'asc' }, // P0 < P1 < P2 alphabetically
      { createdAt: 'asc' },
    ],
    take: slotsAvailable,
  });

  // Filter by per-workspace concurrency
  const schedulable: PrismaRun[] = [];
  const workspaceCounts = new Map<string, number>();

  for (const run of pendingRuns) {
    const wsId = run.workspaceId ?? '__global__';
    const current = workspaceCounts.get(wsId) ?? 0;

    // Count already running runs for this workspace
    if (current === 0) {
      const wsActive = await prisma.run.count({
        where: {
          workspaceId: run.workspaceId,
          status: { in: ['running', 'scheduled'] },
        },
      });
      workspaceCounts.set(wsId, wsActive);
    }

    const wsActive = workspaceCounts.get(wsId) ?? 0;
    if (wsActive < MAX_CONCURRENT_RUNS_PER_WORKSPACE) {
      schedulable.push(run);
      workspaceCounts.set(wsId, wsActive + 1);
    }
  }

  return schedulable;
}

// ── Preemption ──────────────────────────────────────────────────────────

/** Preempt lower-priority runs to make room for higher-priority ones. */
export async function preemptForPriority(
  prisma: PrismaClient,
  incomingPriority: string,
  workspaceId?: string,
): Promise<PrismaRun[]> {
  // Only preempt if incoming is P0
  if (incomingPriority !== 'P0') return [];

  const pausable = await prisma.run.findMany({
    where: {
      status: 'running',
      priority: { in: ['P1', 'P2'] },
      ...(workspaceId ? { workspaceId } : {}),
    },
    orderBy: { priority: 'desc' }, // Pause lowest priority first
  });

  const preempted: PrismaRun[] = [];
  for (const run of pausable) {
    const updated = await transitionRun(prisma, run.id, 'paused', 'Preempted for P0 incident');
    preempted.push(updated);
    if (preempted.length >= 1) break; // Free one slot
  }

  return preempted;
}

// ── Loop Detection ──────────────────────────────────────────────────────

export async function detectLoop(
  prisma: PrismaClient,
  incidentId: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - LOOP_DETECTION_WINDOW_MS);

  const recentRuns = await prisma.run.count({
    where: {
      incidentId,
      createdAt: { gte: windowStart },
    },
  });

  return recentRuns >= LOOP_DETECTION_THRESHOLD;
}

// ── Kill Switch + Quarantine ────────────────────────────────────────────

export async function quarantineRun(
  prisma: PrismaClient,
  runId: string,
  reason: string,
): Promise<PrismaRun> {
  const run = await transitionRun(prisma, runId, 'quarantined', reason);

  // Revoke all active capabilities for this run
  await prisma.capability.updateMany({
    where: { runId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await persistEvent(prisma, {
    type: 'run.quarantined',
    data: { runId, reason },
  });

  return run;
}

export async function killRun(
  prisma: PrismaClient,
  runId: string,
  reason: string,
): Promise<PrismaRun> {
  const run = await prisma.run.findUniqueOrThrow({ where: { id: runId } });

  // Cancel if pending/scheduled, fail if running, quarantine otherwise
  let targetStatus: RunStatus;
  if (run.status === 'pending' || run.status === 'scheduled') {
    targetStatus = 'cancelled';
  } else if (run.status === 'running') {
    targetStatus = 'failed';
  } else if (run.status === 'paused') {
    targetStatus = 'cancelled';
  } else {
    return run; // Already in terminal state
  }

  return transitionRun(prisma, runId, targetStatus, `Kill switch: ${reason}`);
}

// ── Budget Tracking ─────────────────────────────────────────────────────

export async function recordSpend(
  prisma: PrismaClient,
  runId: string,
  amountCents: number,
): Promise<{ exceeded: boolean }> {
  const run = await prisma.run.update({
    where: { id: runId },
    data: { spentCents: { increment: amountCents } },
  });

  const exceeded = run.spentCents >= run.budgetCents;

  if (exceeded) {
    await persistEvent(prisma, {
      type: 'run.budget_exceeded',
      data: { runId, budgetCents: run.budgetCents, spentCents: run.spentCents },
    });

    // Record budget event via normalized emitter
    await emitRunEvent(prisma, runId, 'budget', {
      budgetCents: run.budgetCents,
      spentCents: run.spentCents,
    });
  }

  return { exceeded };
}

// ── Timeout Detection ───────────────────────────────────────────────────

export async function checkTimeouts(prisma: PrismaClient): Promise<PrismaRun[]> {
  const timedOut = await prisma.run.findMany({
    where: {
      status: { in: ['running', 'paused'] },
      timeoutAt: { lte: new Date() },
    },
  });

  const failed: PrismaRun[] = [];
  for (const run of timedOut) {
    const updated = await transitionRun(prisma, run.id, 'failed', 'Timed out');
    failed.push(updated);
  }

  return failed;
}

// Note: sequence number allocation is handled by emitRunEvent() in run-events.ts
