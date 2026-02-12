import clsx from 'clsx';

export interface JourneyStep {
  label: string;
  status: 'done' | 'active' | 'blocked' | 'pending';
}

interface JourneyPipelineProps {
  steps: JourneyStep[];
  className?: string;
}

export function JourneyPipeline({ steps, className }: JourneyPipelineProps) {
  if (!steps.length) return null;

  const done = steps.filter((s) => s.status === 'done').length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const blocked = steps.find((s) => s.status === 'blocked');

  return (
    <div className={clsx('space-y-2', className)}>
      {/* Progress bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
          <div
            className={clsx(
              'h-full rounded-full transition-all duration-500',
              blocked ? 'bg-amber-400' : 'bg-emerald-400',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-text-muted tabular-nums shrink-0">
          {blocked ? `Waiting` : `${pct}%`}
        </span>
      </div>

      {/* Status text */}
      {blocked ? (
        <p className="text-xs text-amber-400">
          Waiting: {blocked.label}
        </p>
      ) : (
        <p className="text-xs text-text-muted">
          {done} of {total} steps completed
        </p>
      )}
    </div>
  );
}

/** Build journey steps from session steps data */
export function buildJourneySteps(
  sessionSteps: Array<{ status: string; humanDescription: string; toolName: string }>,
): JourneyStep[] {
  return sessionSteps.map((s) => ({
    label: s.humanDescription || s.toolName,
    status: s.status === 'completed' ? 'done'
      : s.status === 'blocked' ? 'blocked'
      : s.status === 'denied' || s.status === 'failed' ? 'blocked'
      : s.status === 'pending' ? 'active'
      : 'pending',
  }));
}
