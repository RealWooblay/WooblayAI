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
const LOOP_DETECTION_THRESHOLD = 5; // Same operation, 5 runs in 5 min = loop
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// ── Deterministic Run ID ────────────────────────────────────────────────

function computeRunId(operationId: string, attempt: number): string {
  return createHash('sha256')
    .update(`${operationId}:${attempt}`)
    .digest('hex')
    .slice(0, 24);
}

// ── State Machine ───────────────────────────────────────────────────────

function canTransition(from: RunStatus, to: RunStatus): boolean {
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

  await emitRunEvent(prisma, runId, 'state_change', { from, to, reason });

  await persistEvent(prisma, {
    type: 'run.state_changed',
    data: { runId, from, to, reason },
  });

  return updated;
}

// ── Run Creation ────────────────────────────────────────────────────────

export interface CreateRunInput {
  operationId: string;
  /** @deprecated Use operationId */
  incidentId?: string;
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
  const operationId = input.operationId || input.incidentId!;

  // Determine attempt number
  const existingRuns = await prisma.run.count({
    where: { operationId },
  });
  const attempt = existingRuns + 1;

  const id = computeRunId(operationId, attempt);
  const priority = input.priority ?? 'P2';

  const run = await prisma.run.create({
    data: {
      id,
      operationId,
      priority,
      attempt,
      workspaceId: input.workspaceId ?? null,
      recipe: input.recipe ?? null,
      budgetCents: input.budgetCents ?? 1000,
      parentRunId: input.parentRunId ?? null,
      timeoutAt: new Date(Date.now() + DEFAULT_TIMEOUT_MS),
    },
  });

  await emitRunEvent(prisma, id, 'state_change', { from: null, to: 'pending', reason: 'created' });

  await persistEvent(prisma, {
    type: 'run.created',
    data: { runId: id, operationId, priority },
  });

  // Update operation status to in_progress
  await prisma.operation.update({
    where: { id: operationId },
    data: { status: 'in_progress' },
  });

  return run;
}

// ── Priority Scheduler ──────────────────────────────────────────────────

export async function getSchedulableRuns(
  prisma: PrismaClient,
): Promise<PrismaRun[]> {
  const activeCount = await prisma.run.count({
    where: { status: { in: ['running', 'scheduled'] } },
  });

  if (activeCount >= MAX_GLOBAL_CONCURRENT_RUNS) return [];

  const slotsAvailable = MAX_GLOBAL_CONCURRENT_RUNS - activeCount;

  const pendingRuns = await prisma.run.findMany({
    where: { status: 'pending' },
    orderBy: [
      { priority: 'asc' },
      { createdAt: 'asc' },
    ],
    take: slotsAvailable,
  });

  const schedulable: PrismaRun[] = [];
  const workspaceCounts = new Map<string, number>();

  for (const run of pendingRuns) {
    const wsId = run.workspaceId ?? '__global__';
    const current = workspaceCounts.get(wsId) ?? 0;

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

export async function preemptForPriority(
  prisma: PrismaClient,
  incomingPriority: string,
  workspaceId?: string,
): Promise<PrismaRun[]> {
  if (incomingPriority !== 'P0') return [];

  const pausable = await prisma.run.findMany({
    where: {
      status: 'running',
      priority: { in: ['P1', 'P2'] },
      ...(workspaceId ? { workspaceId } : {}),
    },
    orderBy: { priority: 'desc' },
  });

  const preempted: PrismaRun[] = [];
  for (const run of pausable) {
    const updated = await transitionRun(prisma, run.id, 'paused', 'Preempted for P0 operation');
    preempted.push(updated);
    if (preempted.length >= 1) break;
  }

  return preempted;
}

// ── Loop Detection ──────────────────────────────────────────────────────

export async function detectLoop(
  prisma: PrismaClient,
  operationId: string,
): Promise<boolean> {
  const windowStart = new Date(Date.now() - LOOP_DETECTION_WINDOW_MS);

  const recentRuns = await prisma.run.count({
    where: {
      operationId,
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

  let targetStatus: RunStatus;
  if (run.status === 'pending' || run.status === 'scheduled') {
    targetStatus = 'cancelled';
  } else if (run.status === 'running') {
    targetStatus = 'failed';
  } else if (run.status === 'paused') {
    targetStatus = 'cancelled';
  } else {
    return run;
  }

  return transitionRun(prisma, runId, targetStatus, `Kill switch: ${reason}`);
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
