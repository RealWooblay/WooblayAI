/**
 * Session Page — vertical timeline showing each agent step with status.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { getSessionStatus } from '../../api/client.ts';
import { Badge, statusVariant, riskTierVariant } from '../../components/common/Badge.tsx';
import { relativeTime, truncateHash } from '../../lib/utils.ts';

function stepIcon(status: string) {
  switch (status) {
    case 'completed':
      return (
        <div className="h-8 w-8 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-sm font-bold">
          ✓
        </div>
      );
    case 'blocked':
      return (
        <div className="h-8 w-8 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-sm font-bold animate-pulse">
          ⏳
        </div>
      );
    case 'denied':
      return (
        <div className="h-8 w-8 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center text-sm font-bold">
          ✕
        </div>
      );
    case 'failed':
      return (
        <div className="h-8 w-8 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-sm font-bold">
          !
        </div>
      );
    default:
      return (
        <div className="h-8 w-8 rounded-full bg-gray-500/15 text-gray-400 flex items-center justify-center text-sm">
          ?
        </div>
      );
  }
}

export function SessionPage() {
  const { sessionKey } = useParams<{ sessionKey: string }>();

  const { data: session, isLoading, error } = useQuery({
    queryKey: ['session', sessionKey],
    queryFn: () => getSessionStatus(sessionKey!),
    enabled: !!sessionKey,
    refetchInterval: 5_000,
  });

  if (isLoading) {
    return <div className="py-12 text-center text-text-muted text-sm">Loading session...</div>;
  }

  if (error || !session) {
    return (
      <div className="mx-auto max-w-3xl py-12 text-center">
        <p className="text-text-secondary text-sm">Session not found or has no tool calls.</p>
        <Link to="/activity" className="text-accent text-xs hover:underline mt-2 inline-block">
          Back to Activity
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Session</h1>
          <p className="text-xs font-mono text-text-muted mt-0.5">
            {session.sessionKey}
          </p>
          <div className="flex items-center gap-3 mt-2 text-xs text-text-tertiary">
            <span>
              Agent: <span className="text-text-secondary font-semibold">{session.agent.name}</span>
            </span>
            <span>Trust: <span className="text-text-secondary">{session.agent.trustLevel}</span></span>
            <span>Started: {relativeTime(session.startedAt)}</span>
          </div>
        </div>

        {/* Summary cards */}
        <div className="flex items-center gap-2">
          <SummaryCard label="Total" value={session.summary.totalSteps} color="text-text-primary" />
          <SummaryCard label="Done" value={session.summary.completed} color="text-emerald-400" />
          {session.summary.blocked > 0 && (
            <SummaryCard label="Blocked" value={session.summary.blocked} color="text-blue-400" />
          )}
          {session.summary.denied > 0 && (
            <SummaryCard label="Denied" value={session.summary.denied} color="text-red-400" />
          )}
          {session.summary.failed > 0 && (
            <SummaryCard label="Failed" value={session.summary.failed} color="text-amber-400" />
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-surface-2 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-500"
          style={{
            width: `${session.summary.totalSteps > 0 ? (session.summary.completed / session.summary.totalSteps) * 100 : 0}%`,
          }}
        />
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-px bg-border" />

        <div className="space-y-1">
          {session.steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 px-3 py-2 text-center min-w-[60px]">
      <div className={clsx('text-lg font-bold', color)}>{value}</div>
      <div className="text-[9px] text-text-muted uppercase tracking-wider">{label}</div>
    </div>
  );
}

function StepRow({ step }: { step: import('../../api/client.ts').SessionStep }) {
  return (
    <details className="group">
      <summary className="flex items-center gap-4 px-0 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {/* Icon */}
        <div className="relative z-10 shrink-0">
          {stepIcon(step.status)}
        </div>

        {/* Content */}
        <div className="flex-1 flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3 group-hover:border-border-strong transition-all">
          {/* Step number */}
          <span className="text-[10px] font-mono font-bold text-text-muted w-6 shrink-0">
            #{step.stepNumber}
          </span>

          {/* Description */}
          <div className="flex-1 min-w-0">
            <p className="text-xs text-text-primary">{step.humanDescription}</p>
            <p className="text-[10px] font-mono text-text-muted mt-0.5">{step.toolName}</p>
          </div>

          {/* Badges */}
          <Badge variant={riskTierVariant(step.riskTier)}>{step.riskTier}</Badge>
          <Badge variant={statusVariant(step.status === 'completed' ? 'APPROVED' : step.status === 'blocked' ? 'PENDING' : step.status.toUpperCase())}>
            {step.status.toUpperCase()}
          </Badge>

          {/* Deferred badge */}
          {step.isDeferred && (
            <Badge variant="orange">DEFERRED 24H</Badge>
          )}

          {/* Timestamp */}
          <span className="text-[10px] text-text-muted shrink-0">
            {relativeTime(step.createdAt)}
          </span>
        </div>
      </summary>

      {/* Expanded details */}
      <div className="ml-12 mt-0 mb-2 rounded-lg border border-border bg-surface-0 p-4 space-y-3 animate-fade-in">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Description</div>
            <p className="text-xs text-text-secondary">{step.humanDescription}</p>
          </div>
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Risk Assessment</div>
            <p className="text-xs text-text-secondary">{step.riskExplanation}</p>
          </div>
        </div>

        {/* Args */}
        <div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Arguments</div>
          <pre className="text-[11px] font-mono text-text-tertiary bg-surface-2 rounded p-2 overflow-x-auto max-h-32">
            {JSON.stringify(step.args, null, 2)}
          </pre>
        </div>

        {/* Approval info */}
        {step.approval && (
          <div className="flex items-center gap-3 text-[11px]">
            <span className="text-text-muted">
              Approval: <span className={clsx(
                step.approval.status === 'PENDING' ? 'text-blue-400' :
                step.approval.status === 'APPROVED' ? 'text-emerald-400' :
                'text-red-400'
              )}>{step.approval.status}</span>
            </span>
            {step.approval.approver && (
              <span className="text-text-tertiary">by {step.approval.approver}</span>
            )}
            {step.approval.reason && (
              <span className="text-text-tertiary">"{step.approval.reason}"</span>
            )}
          </div>
        )}

        {/* Execution output */}
        {step.execution && (
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
              Execution (exit: {step.execution.exitCode ?? '?'}, {step.execution.durationMs ?? '?'}ms)
            </div>
            {step.execution.stdout && (
              <pre className="text-[10px] font-mono text-emerald-300/70 bg-surface-2 rounded p-2 overflow-x-auto max-h-24">
                {step.execution.stdout}
              </pre>
            )}
            {step.execution.stderr && (
              <pre className="text-[10px] font-mono text-red-300/70 bg-surface-2 rounded p-2 overflow-x-auto max-h-24 mt-1">
                {step.execution.stderr}
              </pre>
            )}
          </div>
        )}

        {/* Receipt link */}
        {step.receipt && (
          <Link
            to={`/receipts/${step.receipt.hash}`}
            className="text-accent text-[11px] hover:underline font-mono"
          >
            Receipt: {truncateHash(step.receipt.hash, 8)}
          </Link>
        )}
      </div>
    </details>
  );
}
