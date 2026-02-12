import clsx from 'clsx';
import { Card } from '../common/Card.tsx';
import { Badge } from '../common/Badge.tsx';
import { IconCheck, IconX, IconActivity } from '../icons.tsx';
import type { MockCheckpoint } from '../../lib/mock-data.ts';
import { relativeTime } from '../../lib/utils.ts';

interface ReplayCompareViewProps {
  checkpoint: MockCheckpoint;
  originalSteps?: number;
  replaySteps?: number;
  changedOutputs?: number;
  passRate?: { original: number; replay: number };
}

export function ReplayCompareView({
  checkpoint,
  originalSteps = 5,
  replaySteps = 5,
  changedOutputs = 2,
  passRate = { original: 0.8, replay: 1.0 },
}: ReplayCompareViewProps) {
  return (
    <div className="space-y-4">
      {/* Checkpoint header */}
      <div className="flex items-center gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
          <IconActivity size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-stone-800">{checkpoint.label}</h4>
          <div className="flex items-center gap-3 mt-0.5 text-[11px] text-stone-500">
            <span>Scope: <span className="text-stone-600 font-mono">{checkpoint.scope}</span></span>
            <span>{relativeTime(checkpoint.createdAt)}</span>
            <span>Agent: <span className="text-stone-600">{checkpoint.agentName}</span></span>
          </div>
        </div>
        <Badge variant="purple">Checkpoint</Badge>
      </div>

      {/* Comparison grid */}
      <div className="grid grid-cols-2 gap-4">
        {/* Original */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-stone-500">Original Run</h5>
            <Badge variant={passRate.original >= 1 ? 'green' : 'yellow'}>
              {(passRate.original * 100).toFixed(0)}% pass
            </Badge>
          </div>
          <div className="space-y-2">
            {Array.from({ length: originalSteps }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md bg-stone-50 px-3 py-2">
                <span className="text-[10px] font-mono text-stone-400">#{i + 1}</span>
                <div className="h-2 flex-1 rounded-full bg-stone-200 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full',
                      i < Math.round(passRate.original * originalSteps)
                        ? 'bg-green-500'
                        : 'bg-red-400',
                    )}
                    style={{ width: '100%' }}
                  />
                </div>
                {i < Math.round(passRate.original * originalSteps) ? (
                  <IconCheck size={12} className="text-green-600" />
                ) : (
                  <IconX size={12} className="text-red-600" />
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Replay */}
        <Card className="space-y-3 ring-1 ring-blue-200">
          <div className="flex items-center justify-between">
            <h5 className="text-xs font-semibold uppercase tracking-wider text-blue-600">Replay Run</h5>
            <Badge variant={passRate.replay >= 1 ? 'green' : 'yellow'}>
              {(passRate.replay * 100).toFixed(0)}% pass
            </Badge>
          </div>
          <div className="space-y-2">
            {Array.from({ length: replaySteps }).map((_, i) => (
              <div key={i} className={clsx(
                'flex items-center gap-2 rounded-md px-3 py-2',
                i < changedOutputs ? 'bg-blue-50 ring-1 ring-blue-200' : 'bg-stone-50',
              )}>
                <span className="text-[10px] font-mono text-stone-400">#{i + 1}</span>
                <div className="h-2 flex-1 rounded-full bg-stone-200 overflow-hidden">
                  <div
                    className={clsx(
                      'h-full rounded-full',
                      i < Math.round(passRate.replay * replaySteps)
                        ? 'bg-blue-500'
                        : 'bg-red-400',
                    )}
                    style={{ width: '100%' }}
                  />
                </div>
                {i < changedOutputs ? (
                  <span className="text-[9px] text-blue-600 font-semibold">CHANGED</span>
                ) : i < Math.round(passRate.replay * replaySteps) ? (
                  <IconCheck size={12} className="text-green-600" />
                ) : (
                  <IconX size={12} className="text-red-600" />
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-center">
          <p className="text-lg font-bold text-blue-600">{changedOutputs}</p>
          <p className="text-[10px] text-stone-500 mt-0.5">Changed Outputs</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-center">
          <p className="text-lg font-bold text-green-600">{replaySteps}</p>
          <p className="text-[10px] text-stone-500 mt-0.5">Replay Steps</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3 text-center">
          <p className={clsx(
            'text-lg font-bold',
            passRate.replay > passRate.original ? 'text-green-600' : passRate.replay < passRate.original ? 'text-red-600' : 'text-stone-500',
          )}>
            {passRate.replay > passRate.original ? '+' : ''}{((passRate.replay - passRate.original) * 100).toFixed(0)}%
          </p>
          <p className="text-[10px] text-stone-500 mt-0.5">Pass Rate Delta</p>
        </div>
      </div>
    </div>
  );
}
