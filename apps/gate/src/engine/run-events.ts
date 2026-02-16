/**
 * Run Event Emitter — normalized, atomic event ingestion.
 *
 * Single entry point for ALL run events. Guarantees:
 * - Monotonic sequence numbers (atomic allocation)
 * - Consistent data format
 * - Persisted to RunEvent table + emitted to EventBus
 *
 * EVERY part of the system that records a run event MUST go through this.
 */

import type { PrismaClient } from '@prisma/client';
import { persistEvent } from '../events/bus.js';

export type RunEventType =
  | 'state_change'
  | 'tool_call'
  | 'evidence'
  | 'approval'
  | 'verification'
  | 'gateway_exec'
  | 'capability'
  | 'error'
  | 'budget'
  | 'rollback';

/**
 * Emit a run event with atomic sequence number allocation.
 *
 * This is the ONLY function that should create RunEvent records.
 */
export async function emitRunEvent(
  prisma: PrismaClient,
  runId: string,
  type: RunEventType,
  data: Record<string, unknown>,
): Promise<{ id: string; sequenceNum: number }> {
  // Atomic sequence number allocation:
  // Use a transaction to read the current max + 1 atomically.
  const result = await prisma.$transaction(async (tx) => {
    const last = await tx.runEvent.findFirst({
      where: { runId },
      orderBy: { sequenceNum: 'desc' },
      select: { sequenceNum: true },
    });

    const sequenceNum = (last?.sequenceNum ?? 0) + 1;

    const event = await tx.runEvent.create({
      data: {
        runId,
        type,
        data: JSON.stringify(data),
        sequenceNum,
      },
    });

    return { id: event.id, sequenceNum };
  });

  return result;
}

/**
 * Emit a run event AND persist to the global event bus.
 * Use this for events that should also appear in the global event stream.
 */
export async function emitRunEventWithBus(
  prisma: PrismaClient,
  runId: string,
  type: RunEventType,
  data: Record<string, unknown>,
  busEvent?: Parameters<typeof persistEvent>[1],
): Promise<{ id: string; sequenceNum: number }> {
  const result = await emitRunEvent(prisma, runId, type, data);

  if (busEvent) {
    await persistEvent(prisma, busEvent);
  }

  return result;
}
