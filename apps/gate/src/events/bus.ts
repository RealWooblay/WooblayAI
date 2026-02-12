/**
 * Typed event bus for Wooblay Gate.
 *
 * Provides a simple pub/sub mechanism backed by Node's EventEmitter, plus a
 * helper to persist events into the EventLog table for SSE replay.
 */

import { EventEmitter } from 'node:events';
import type { PrismaClient } from '@prisma/client';
import type { WooblayEvent, WooblayEventType } from '@wooblay/types';

class WooblayEventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many SSE subscribers without warning
    this.emitter.setMaxListeners(200);
  }

  /** Emit a typed event to all subscribers. */
  emit(event: WooblayEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event); // wildcard listener for SSE
  }

  /** Subscribe to a specific event type. */
  on(type: WooblayEventType | '*', callback: (event: WooblayEvent) => void): void {
    this.emitter.on(type, callback);
  }

  /** Unsubscribe from a specific event type. */
  off(type: WooblayEventType | '*', callback: (event: WooblayEvent) => void): void {
    this.emitter.off(type, callback);
  }
}

/** Singleton event bus instance. */
export const eventBus = new WooblayEventBus();

/**
 * Persist a WooblayEvent into the EventLog table and emit it on the bus.
 */
export async function persistEvent(
  prisma: PrismaClient,
  event: WooblayEvent,
): Promise<void> {
  await prisma.eventLog.create({
    data: {
      type: event.type,
      data: JSON.stringify(event.data),
    },
  });
  eventBus.emit(event);
}
