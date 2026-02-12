import clsx from 'clsx';
import type { MockActionPR } from '../../lib/mock-data.ts';

interface ActionDiffViewerProps {
  action: MockActionPR;
  compact?: boolean;
}

export function ActionDiffViewer({ action, compact = false }: ActionDiffViewerProps) {
  // For exec actions: show command + affected paths
  if (action.toolName === 'wooblay_exec' && action.command) {
    return (
      <div className="space-y-3">
        {!compact && (
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Command Execution
          </h4>
        )}
        <pre className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs font-mono overflow-x-auto">
          <span className="text-stone-400 select-none">$ </span>
          <span className="text-stone-800">{action.command}</span>
        </pre>

        {action.affectedPaths && action.affectedPaths.length > 0 && (
          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
              Affected Paths
            </h5>
            <div className="rounded-md border border-stone-200 bg-stone-50 divide-y divide-stone-200">
              {action.affectedPaths.map((path, i) => (
                <div key={i} className="px-3 py-1.5 text-xs font-mono">
                  <span className="text-amber-600 select-none">M  </span>
                  <span className="text-stone-700">{path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // For HTTP/browser actions: show target + steps
  if (action.targetDomain || action.steps) {
    return (
      <div className="space-y-3">
        {action.targetDomain && (
          <>
            {!compact && (
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                Target Domain
              </h4>
            )}
            <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
              <span className="text-xs font-mono text-stone-800">{action.targetDomain}</span>
            </div>
          </>
        )}

        {action.steps && action.steps.length > 0 && (
          <div>
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400 mb-1.5">
              Steps
            </h5>
            <div className="rounded-md border border-stone-200 bg-stone-50 divide-y divide-stone-200">
              {action.steps.map((step, i) => (
                <div key={i} className="flex items-start gap-2.5 px-3 py-2">
                  <span className={clsx(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold mt-0.5',
                    'bg-blue-50 text-blue-600',
                  )}>
                    {i + 1}
                  </span>
                  <span className="text-xs text-stone-700 leading-relaxed">{step}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback: JSON diff
  return (
    <div className="space-y-3">
      {!compact && (
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          Action Parameters
        </h4>
      )}
      <pre className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs font-mono text-stone-600 overflow-x-auto max-h-64">
        {JSON.stringify({
          toolName: action.toolName,
          riskTier: action.riskTier,
          adapter: action.adapter,
          idempotencyKey: action.idempotencyKey,
        }, null, 2)}
      </pre>
    </div>
  );
}
