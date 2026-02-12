import { useParams, Link } from 'react-router-dom';
import { useTimeline } from '../../api/hooks/useTimeline.ts';
import { Badge, riskTierVariant, statusVariant, adapterVariant, adapterLabel } from '../../components/common/Badge.tsx';
import { Card } from '../../components/common/Card.tsx';
import clsx from 'clsx';

function decisionColor(decision: string | null | undefined): string {
  if (!decision) return 'bg-gray-600';
  switch (decision.toUpperCase()) {
    case 'ALLOW':
    case 'EXECUTE':
    case 'APPROVED':
      return 'bg-emerald-500';
    case 'DENY':
    case 'DENIED':
      return 'bg-red-500';
    case 'APPROVE':
    case 'PENDING':
    case 'PENDING_APPROVAL':
      return 'bg-amber-500';
    default:
      return 'bg-gray-600';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function TimelinePage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: entries, isLoading, error } = useTimeline(taskId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading timeline…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-red-400">
        Error: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h2 className="text-lg font-semibold text-gray-100">
        Task Timeline{' '}
        <span className="font-mono text-sm text-gray-400">
          {taskId ? truncate(taskId, 20) : ''}
        </span>
      </h2>

      {!entries?.length ? (
        <Card className="py-12 text-center text-gray-500">
          No timeline entries found for this task.
        </Card>
      ) : (
        <div className="relative ml-4 border-l-2 border-gray-800 pl-6 space-y-6">
          {entries.map((entry, idx) => {
            const { toolCall, receipt, approval } = entry;
            const decision = receipt?.policyDecision ?? approval?.status ?? null;

            return (
              <div key={toolCall.id} className="relative">
                {/* Node dot */}
                <div
                  className={clsx(
                    'absolute -left-[31px] top-1 h-4 w-4 rounded-full border-2 border-gray-950',
                    decisionColor(decision),
                  )}
                />

                <Card>
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-gray-100">
                          {toolCall.toolName}
                        </span>
                        <Badge variant={riskTierVariant(toolCall.riskTier)}>
                          {toolCall.riskTier}
                        </Badge>
                        {decision && (
                          <Badge variant={statusVariant(decision)}>
                            {decision}
                          </Badge>
                        )}
                        {toolCall.adapter && (
                          <Badge variant={adapterVariant(toolCall.adapter)}>
                            {adapterLabel(toolCall.adapter)}
                          </Badge>
                        )}
                      </div>

                      {/* Args preview */}
                      <p className="font-mono text-xs text-gray-500">
                        {truncate(toolCall.args, 120)}
                      </p>

                      {/* Execution result */}
                      {receipt?.executionSummary && (
                        <p className="text-xs text-gray-400">
                          exit {receipt.executionSummary.exitCode ?? '?'} &middot;{' '}
                          {receipt.executionSummary.durationMs}ms &middot;{' '}
                          {truncate(receipt.executionSummary.stdoutPreview, 80)}
                        </p>
                      )}
                    </div>

                    {/* Receipt link */}
                    <div className="shrink-0 text-right text-xs">
                      <span className="text-gray-600">#{idx + 1}</span>
                      {receipt && (
                        <div className="mt-1">
                          <Link
                            to={`/receipts/${receipt.hash}`}
                            className="text-indigo-400 hover:text-indigo-300"
                          >
                            receipt →
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
