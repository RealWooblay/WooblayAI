import { useState } from 'react';
import clsx from 'clsx';
import { Card } from '../../components/common/Card.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Badge } from '../../components/common/Badge.tsx';
import { ReplayCompareView } from '../../components/timeline/ReplayCompareView.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import {
  IconRewind,
  IconPlay,
  IconUndo,
  IconActivity,
  IconChevronRight,
} from '../../components/icons.tsx';
import { MOCK_CHECKPOINTS, MOCK_ACTION_PRS } from '../../lib/mock-data.ts';
import { relativeTime } from '../../lib/utils.ts';

export function RewindPage() {
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(null);
  const [showReplay, setShowReplay] = useState(false);

  const selected = MOCK_CHECKPOINTS.find(c => c.id === selectedCheckpoint);

  const sorted = [...MOCK_CHECKPOINTS].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Timeline */}
        <div className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-800">Checkpoint Timeline</h3>
            <span className="text-[10px] text-stone-400">{sorted.length} checkpoints</span>
          </div>

          <div className="relative">
            {sorted.map((ckpt, idx) => {
              const isSelected = ckpt.id === selectedCheckpoint;
              const isLast = idx === sorted.length - 1;
              const relatedAction = MOCK_ACTION_PRS.find(a => a.taskId === ckpt.taskId);

              return (
                <div key={ckpt.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <button
                      onClick={() => setSelectedCheckpoint(isSelected ? null : ckpt.id)}
                      className={clsx(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 transition-all cursor-pointer z-10',
                        isSelected
                          ? 'border-blue-500 bg-blue-50 text-blue-600'
                          : 'border-stone-200 bg-white text-stone-400 hover:border-stone-300 hover:text-stone-500',
                      )}
                    >
                      <IconActivity size={14} />
                    </button>
                    {!isLast && (
                      <div className={clsx(
                        'w-px flex-1 border-l border-dashed',
                        isSelected ? 'border-blue-300' : 'border-stone-200',
                      )} style={{ minHeight: 32 }} />
                    )}
                  </div>

                  <div
                    className={clsx(
                      'flex-1 rounded-lg border p-3 mb-3 transition-all cursor-pointer',
                      isSelected
                        ? 'border-blue-200 bg-blue-50/50 ring-1 ring-blue-100'
                        : 'border-stone-200 bg-white hover:bg-stone-50',
                    )}
                    onClick={() => setSelectedCheckpoint(isSelected ? null : ckpt.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="text-xs font-semibold text-stone-800">{ckpt.label}</h4>
                        <div className="flex items-center gap-2 mt-1 text-[10px] text-stone-400">
                          <span className="font-mono">{ckpt.scope}</span>
                          <span>·</span>
                          <span>{ckpt.agentName}</span>
                          <span>·</span>
                          <span>{relativeTime(ckpt.createdAt)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="gray">{ckpt.actionCount} actions</Badge>
                        <IconChevronRight
                          size={12}
                          className={clsx(
                            'text-stone-400 transition-transform',
                            isSelected && 'rotate-90 text-blue-500',
                          )}
                        />
                      </div>
                    </div>

                    {relatedAction && (
                      <div className="mt-2 rounded-md bg-stone-50 border border-stone-100 px-2.5 py-1.5 text-[10px] text-stone-500 truncate">
                        {relatedAction.title}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Detail */}
        <div className="lg:col-span-7 space-y-4">
          {!selected ? (
            <EmptyState
              icon={<IconRewind size={40} />}
              title="Select a checkpoint"
              description="Click on a checkpoint in the timeline to view details, replay from that point, or initiate a rollback."
            />
          ) : (
            <>
              <Card className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-800">{selected.label}</h3>
                    <p className="text-[11px] text-stone-400 mt-0.5">
                      Scope: <span className="font-mono text-stone-500">{selected.scope}</span> · Tool: <span className="font-mono text-stone-500">{selected.toolName}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => setShowReplay(!showReplay)}
                    >
                      <IconPlay size={14} />
                      {showReplay ? 'Hide Replay' : 'Replay from Here'}
                    </Button>
                    <Button size="sm" variant="secondary">
                      <IconUndo size={14} />
                      Restore
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: 'Actions Before', value: selected.actionCount },
                    { label: 'Agent', value: selected.agentName },
                    { label: 'Tool', value: selected.toolName.replace('wooblay_', '') },
                    { label: 'Created', value: relativeTime(selected.createdAt) },
                  ].map(item => (
                    <div key={item.label} className="rounded-md bg-stone-50 border border-stone-200 p-3 text-center">
                      <p className="text-sm font-bold text-stone-800">{item.value}</p>
                      <p className="text-[9px] text-stone-400">{item.label}</p>
                    </div>
                  ))}
                </div>

                {selected.metadata && (
                  <div className="rounded-md bg-stone-50 border border-stone-200 p-3">
                    <h5 className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">Metadata</h5>
                    <pre className="text-xs font-mono text-stone-600">
                      {JSON.stringify(selected.metadata, null, 2)}
                    </pre>
                  </div>
                )}
              </Card>

              {showReplay && (
                <div className="animate-slide-in">
                  <ReplayCompareView
                    checkpoint={selected}
                    originalSteps={selected.actionCount + 3}
                    replaySteps={selected.actionCount + 3}
                    changedOutputs={Math.max(1, Math.floor(selected.actionCount / 2))}
                    passRate={{
                      original: 0.8 + Math.random() * 0.15,
                      replay: 0.9 + Math.random() * 0.1,
                    }}
                  />
                </div>
              )}

              <Card className="space-y-3 border-l-2 border-l-purple-400">
                <div className="flex items-center gap-2">
                  <IconUndo size={16} className="text-purple-600" />
                  <h4 className="text-sm font-semibold text-stone-800">Rollback Preview</h4>
                  <Badge variant="purple">Creates new Action PR</Badge>
                </div>
                <p className="text-xs text-stone-500">
                  Rolling back to this checkpoint will create a new "Rollback PR" that restores the state of <span className="font-mono text-stone-600">{selected.scope}</span> to the snapshot taken at this checkpoint.
                </p>
                <pre className="rounded-md bg-stone-50 border border-stone-200 p-3 text-xs font-mono">
                  <span className="text-purple-600">Rollback PR:</span> Restore {selected.scope} to checkpoint {selected.id}
                  {'\n'}<span className="text-stone-400">  scope:</span> <span className="text-stone-600">{selected.scope}</span>
                  {'\n'}<span className="text-stone-400">  target:</span> <span className="text-stone-600">{selected.id}</span>
                  {'\n'}<span className="text-stone-400">  risk:</span> <span className="text-amber-600">WRITE</span>
                </pre>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
