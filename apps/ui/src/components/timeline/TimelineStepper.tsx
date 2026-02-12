import clsx from 'clsx';
import { IconCheck, IconX, IconClock } from '../icons.tsx';
import { formatDuration } from '../../lib/utils.ts';
import type { MockToolCall } from '../../lib/mock-data.ts';

interface TimelineStepperProps {
  steps: MockToolCall[];
  collapsed?: boolean;
}

function stepIcon(status: string) {
  switch (status) {
    case 'success': return <IconCheck size={14} className="text-green-600" />;
    case 'failed': return <IconX size={14} className="text-red-600" />;
    case 'pending': return <IconClock size={14} className="text-blue-600" />;
    default: return <IconClock size={14} className="text-stone-400" />;
  }
}

function stepColor(status: string) {
  switch (status) {
    case 'success': return { bg: 'bg-green-50', line: 'border-green-200' };
    case 'failed': return { bg: 'bg-red-50', line: 'border-red-200' };
    case 'pending': return { bg: 'bg-blue-50', line: 'border-blue-200' };
    default: return { bg: 'bg-stone-50', line: 'border-stone-200' };
  }
}

export function TimelineStepper({ steps, collapsed }: TimelineStepperProps) {
  if (steps.length === 0) return null;

  const displaySteps = collapsed ? steps.slice(0, 3) : steps;
  const hasMore = collapsed && steps.length > 3;

  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-stone-500">
        Decision Trail ({steps.length} steps)
      </h4>

      <div className="relative">
        {displaySteps.map((step, i) => {
          const colors = stepColor(step.status);
          const isLast = i === displaySteps.length - 1;

          return (
            <div key={i} className="flex gap-3">
              {/* Timeline line + dot */}
              <div className="flex flex-col items-center">
                <div className={clsx(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  colors.bg,
                )}>
                  {stepIcon(step.status)}
                </div>
                {!isLast && (
                  <div className={clsx('w-px flex-1 border-l', colors.line)} style={{ minHeight: 20 }} />
                )}
              </div>

              {/* Content */}
              <div className={clsx('pb-4 min-w-0 flex-1', isLast && 'pb-0')}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-stone-400 shrink-0">
                    #{step.step}
                  </span>
                  <span className="text-xs font-semibold font-mono text-stone-700 truncate">
                    {step.toolName}
                  </span>
                  {step.duration && (
                    <span className="text-[10px] text-stone-400 shrink-0">
                      {formatDuration(step.duration)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[11px] font-mono text-stone-500 truncate">
                  {step.args}
                </p>
                {step.output && (
                  <p className="mt-0.5 text-[11px] text-stone-500">
                    → {step.output}
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {hasMore && (
          <div className="flex items-center gap-3 text-[11px] text-stone-400">
            <div className="flex h-6 w-6 items-center justify-center">
              <span>...</span>
            </div>
            <span>+{steps.length - 3} more steps</span>
          </div>
        )}
      </div>
    </div>
  );
}
