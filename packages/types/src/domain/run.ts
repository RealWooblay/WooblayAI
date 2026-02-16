export type RunStatus =
  | 'pending'
  | 'scheduled'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'quarantined'
  | 'cancelled';

export type RunPriority = 'P0' | 'P1' | 'P2';

export interface Run {
  id: string;
  incidentId: string;
  workspaceId: string | null;
  status: RunStatus;
  priority: RunPriority;
  attempt: number;
  statePointer: string | null;
  parentRunId: string | null;
  recipe: string | null;
  budgetCents: number;
  spentCents: number;
  startedAt: string | null;
  completedAt: string | null;
  pausedAt: string | null;
  timeoutAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Valid state transitions for the Run state machine. */
export const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  pending:     ['scheduled', 'cancelled'],
  scheduled:   ['running', 'cancelled'],
  running:     ['paused', 'completed', 'failed', 'quarantined'],
  paused:      ['running', 'cancelled', 'quarantined'],
  completed:   [],
  failed:      [],
  quarantined: ['cancelled'],
  cancelled:   [],
};
