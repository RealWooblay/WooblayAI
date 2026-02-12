/**
 * Activity Feed — real-time observability into agent actions.
 * Wired to GET /api/activity with 5s auto-refresh.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { getActivity, getActivitySummary, type ActivityItem } from '../../api/client.ts';
import { Badge, statusVariant, riskTierVariant } from '../../components/common/Badge.tsx';
import { relativeTime, truncate, truncateHash } from '../../lib/utils.ts';

type StatusFilter = 'all' | 'pending' | 'approved' | 'denied' | 'executed' | 'auto-allowed';
type RiskFilter = 'all' | 'READ' | 'WRITE' | 'DESTRUCTIVE';

function avatarBg(name: string): string {
  const colors = [
    'bg-blue-500/15 text-blue-400',
    'bg-violet-500/15 text-violet-400',
    'bg-emerald-500/15 text-emerald-400',
    'bg-amber-500/15 text-amber-400',
    'bg-rose-500/15 text-rose-400',
    'bg-cyan-500/15 text-cyan-400',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'pending' ? 'bg-blue-400 animate-pulse' :
    status === 'approved' || status === 'executed' || status === 'auto-allowed' ? 'bg-emerald-400' :
    status === 'denied' ? 'bg-red-400' :
    'bg-gray-400';
  return <span className={clsx('inline-block h-2 w-2 rounded-full', color)} />;
}

export function FeedPage() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filters = useMemo(() => ({
    page,
    pageSize: 50,
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(riskFilter !== 'all' ? { riskTier: riskFilter } : {}),
  }), [page, statusFilter, riskFilter]);

  const { data, isLoading } = useQuery({
    queryKey: ['activity', filters],
    queryFn: () => getActivity(filters),
    refetchInterval: 5_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['activitySummary'],
    queryFn: getActivitySummary,
    refetchInterval: 5_000,
  });

  const items = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 50);

  const statusFilters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'pending', label: 'Pending' },
    { key: 'auto-allowed', label: 'Auto-Allowed' },
    { key: 'approved', label: 'Approved' },
    { key: 'executed', label: 'Executed' },
    { key: 'denied', label: 'Denied' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Activity Feed</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            Real-time view of all agent actions routed through Wooblay.
            {summary && (
              <span className="ml-2">
                {summary.total} total actions
                {summary.pending > 0 && (
                  <span className="text-blue-400 ml-1">
                    ({summary.pending} pending approval)
                  </span>
                )}
                {summary.recentCount > 0 && (
                  <span className="text-text-muted ml-1">
                    / {summary.recentCount} in last hour
                  </span>
                )}
              </span>
            )}
          </p>
        </div>

        {/* Risk filter */}
        <div className="flex items-center gap-1">
          {(['all', 'READ', 'WRITE', 'DESTRUCTIVE'] as RiskFilter[]).map((f) => (
            <button
              key={f}
              onClick={() => { setRiskFilter(f); setPage(1); }}
              className={clsx(
                'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                riskFilter === f
                  ? 'bg-surface-2 text-text-primary ring-1 ring-border'
                  : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {f === 'all' ? 'All Risks' : f}
            </button>
          ))}
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-2">
        {statusFilters.map((f) => (
          <button
            key={f.key}
            onClick={() => { setStatusFilter(f.key); setPage(1); }}
            className={clsx(
              'rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer',
              statusFilter === f.key
                ? 'bg-accent-subtle text-accent-bright'
                : 'text-text-muted hover:text-text-secondary hover:bg-surface-1',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="py-12 text-center text-text-muted text-sm">Loading activity...</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface-1 py-16 text-center">
          <div className="text-3xl opacity-20 mb-3">📡</div>
          <p className="text-text-secondary text-sm">No activity yet</p>
          <p className="text-text-muted text-xs mt-1">Agent actions will appear here as they are routed through Wooblay.</p>
        </div>
      ) : (
        <>
          {/* Table header */}
          <div className="flex items-center gap-3 px-4 py-2 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            <span className="w-6" />
            <span className="w-32">Agent</span>
            <span className="flex-1">Action</span>
            <span className="w-24">Risk</span>
            <span className="w-28">Status</span>
            <span className="w-16 text-right">Time</span>
          </div>

          {/* Rows */}
          <div className="space-y-1">
            {items.map((item) => (
              <ActivityRow
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
              />
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-3">
              <span className="text-xs text-text-muted">
                Page {page} of {totalPages} ({total} actions)
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="rounded px-3 py-1 text-xs text-text-secondary bg-surface-1 border border-border hover:bg-surface-2 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  Prev
                </button>
                <button
                  onClick={() => setPage(Math.min(totalPages, page + 1))}
                  disabled={page >= totalPages}
                  className="rounded px-3 py-1 text-xs text-text-secondary bg-surface-1 border border-border hover:bg-surface-2 disabled:opacity-30 cursor-pointer disabled:cursor-default"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Single activity row with expand/collapse. */
function ActivityRow({
  item,
  expanded,
  onToggle,
}: {
  item: ActivityItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusLabel =
    item.status === 'auto-allowed' ? 'AUTO' :
    item.status === 'pending' ? 'PENDING' :
    item.status.toUpperCase();

  return (
    <div
      className={clsx(
        'rounded-lg border transition-all cursor-pointer',
        expanded
          ? 'border-accent/30 bg-surface-1 glow-accent'
          : 'border-border bg-surface-1 hover:border-border-strong',
      )}
    >
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        onClick={onToggle}
      >
        <StatusDot status={item.status} />

        {/* Agent */}
        <div className="w-32 flex items-center gap-2 shrink-0">
          <div
            className={clsx(
              'flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-bold shrink-0',
              avatarBg(item.agent.name),
            )}
          >
            {item.agent.name.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs font-medium text-text-primary truncate">
            {item.agent.name}
          </span>
        </div>

        {/* Action description */}
        <div className="flex-1 min-w-0">
          <span className="text-xs text-text-primary">
            {truncate(item.humanDescription, 60)}
          </span>
          <span className="ml-2 text-[10px] font-mono text-text-muted">
            {item.toolName}
          </span>
        </div>

        {/* Risk */}
        <span className="w-24 shrink-0">
          <Badge variant={riskTierVariant(item.riskTier)}>{item.riskTier}</Badge>
        </span>

        {/* Status */}
        <span className="w-28 shrink-0">
          <Badge variant={statusVariant(statusLabel)}>{statusLabel}</Badge>
        </span>

        {/* Time */}
        <span className="w-16 text-right text-[11px] text-text-muted shrink-0">
          {relativeTime(item.createdAt)}
        </span>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 animate-fade-in">
          {/* Description + Risk explanation */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Description</div>
              <p className="text-xs text-text-secondary">{item.humanDescription}</p>
            </div>
            <div>
              <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Risk Assessment</div>
              <p className="text-xs text-text-secondary">{item.riskExplanation}</p>
            </div>
          </div>

          {/* Args */}
          <div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Arguments</div>
            <pre className="text-[11px] font-mono text-text-tertiary bg-surface-0 rounded p-2 overflow-x-auto max-h-32">
              {JSON.stringify(item.args, null, 2)}
            </pre>
          </div>

          {/* Metadata row */}
          <div className="flex items-center gap-4 flex-wrap text-[11px]">
            {item.adapter && (
              <span className="text-text-muted">
                Adapter: <span className="text-text-secondary">{item.adapter}</span>
              </span>
            )}
            {item.sessionId && (
              <Link
                to={`/sessions/${encodeURIComponent(item.sessionId)}`}
                className="text-accent hover:underline"
              >
                Session: {truncate(item.sessionId, 20)}
              </Link>
            )}
            {item.approval && (
              <span className="text-text-muted">
                Approval: <span className={clsx(
                  item.approval.status === 'PENDING' ? 'text-blue-400' :
                  item.approval.status === 'APPROVED' ? 'text-emerald-400' :
                  'text-red-400'
                )}>{item.approval.status}</span>
                {item.approval.approver && (
                  <span className="text-text-tertiary"> by {item.approval.approver}</span>
                )}
              </span>
            )}
            {item.execution && (
              <span className="text-text-muted">
                Exit: <span className={clsx(
                  item.execution.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'
                )}>{item.execution.exitCode ?? '?'}</span>
                {item.execution.durationMs != null && (
                  <span className="text-text-tertiary"> ({item.execution.durationMs}ms)</span>
                )}
              </span>
            )}
            {item.receipt && (
              <Link
                to={`/receipts/${item.receipt.hash}`}
                className="text-accent hover:underline font-mono"
              >
                Receipt: {truncateHash(item.receipt.hash, 6)}
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
