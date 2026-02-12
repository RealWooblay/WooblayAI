import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getActivity,
  getFlags,
  dismissFlag,
  type ActivityItem,
  type AuditFlag,
} from '../../api/client.ts';

const riskColor: Record<string, string> = {
  READ: 'text-blue-400 bg-blue-500/10',
  WRITE: 'text-amber-400 bg-amber-500/10',
  DESTRUCTIVE: 'text-red-400 bg-red-500/10',
};

const statusColor: Record<string, string> = {
  allowed: 'text-emerald-400',
  'auto-allowed': 'text-emerald-400',
  approved: 'text-yellow-400',
  denied: 'text-red-400',
  pending: 'text-amber-400',
  executed: 'text-emerald-400',
};

const severityColor: Record<string, string> = {
  CRITICAL: 'bg-red-500/15 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  LOW: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  INFO: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

export function ActivityPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [riskFilter, setRiskFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showFlags, setShowFlags] = useState(false);

  const { data: activity, isLoading } = useQuery({
    queryKey: ['activity', page, riskFilter, statusFilter],
    queryFn: () => getActivity({ page, pageSize: 30, riskTier: riskFilter, status: statusFilter }),
    refetchInterval: 10_000,
  });

  const { data: flagsData } = useQuery({
    queryKey: ['flags'],
    queryFn: () => getFlags({ dismissed: 'false', limit: '50' }),
    refetchInterval: 15_000,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissFlag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });

  const flags = flagsData?.flags ?? [];
  const flagSummary = flagsData?.summary ?? {};
  const totalFlags = Object.values(flagSummary).reduce((a, b) => a + b, 0);

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Activity</h1>
          <p className="text-sm text-text-muted mt-0.5">All agent actions in real-time</p>
        </div>
        <button
          onClick={() => setShowFlags(!showFlags)}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            totalFlags > 0
              ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
              : 'bg-surface-2 border-border text-text-muted hover:bg-surface-3'
          }`}
        >
          {totalFlags > 0 ? `${totalFlags} Flags` : 'No Flags'}{' '}
          {flagSummary['CRITICAL'] ? `(${flagSummary['CRITICAL']} critical)` : ''}
        </button>
      </div>

      {/* Flag Banner */}
      {totalFlags > 0 && (
        <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 flex items-center gap-3">
          <span className="text-red-400 text-xs font-medium">
            {flagSummary['CRITICAL'] ?? 0} critical &middot; {flagSummary['HIGH'] ?? 0} high &middot; {flagSummary['MEDIUM'] ?? 0} medium
          </span>
          <button
            onClick={() => setShowFlags(true)}
            className="ml-auto text-xs text-red-300 hover:text-red-200 underline"
          >
            View All
          </button>
        </div>
      )}

      {/* Flag Panel */}
      {showFlags && (
        <div className="bg-surface-1 border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-text-primary">Detected Flags</h2>
            <button onClick={() => setShowFlags(false)} className="text-xs text-text-muted hover:text-text-primary">&times; Close</button>
          </div>
          {flags.length === 0 ? (
            <p className="text-sm text-text-muted">No active flags.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {flags.map((flag: AuditFlag) => (
                <div key={flag.id} className={`rounded-lg border p-3 ${severityColor[flag.severity] ?? ''}`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] font-bold uppercase">{flag.severity}</span>
                      <span className="text-[10px] mx-2 opacity-50">&middot;</span>
                      <span className="text-[10px] opacity-70">{flag.category.replace(/_/g, ' ')}</span>
                      <p className="text-xs font-medium mt-1">{flag.title}</p>
                      <p className="text-[11px] opacity-80 mt-0.5">{flag.description}</p>
                    </div>
                    <button
                      onClick={() => dismissMutation.mutate(flag.id)}
                      className="text-[10px] opacity-50 hover:opacity-100 ml-3 shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={riskFilter}
          onChange={(e) => { setRiskFilter(e.target.value); setPage(1); }}
          className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none"
        >
          <option value="">All Risk</option>
          <option value="READ">READ</option>
          <option value="WRITE">WRITE</option>
          <option value="DESTRUCTIVE">DESTRUCTIVE</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="allowed">Allowed</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Activity Table */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-text-muted text-sm animate-pulse">Loading activity...</div>
        ) : !activity?.data.length ? (
          <div className="p-8 text-center text-text-muted text-sm">No activity recorded yet.</div>
        ) : (
          <div className="divide-y divide-border">
            {activity.data.map((item: ActivityItem) => (
              <div key={item.id}>
                <button
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  className="w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors flex items-center gap-3"
                >
                  <span className="text-[10px] text-text-muted w-[130px] shrink-0 font-mono">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                  <span className="text-xs text-text-muted w-24 shrink-0 truncate">
                    {item.agent?.name ?? '?'}
                  </span>
                  <span className="text-sm text-text-primary flex-1 truncate">
                    {item.humanDescription}
                  </span>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${riskColor[item.riskTier] ?? 'text-zinc-400'}`}>
                    {item.riskTier}
                  </span>
                  <span className={`text-[10px] font-medium w-16 text-right ${statusColor[item.status] ?? 'text-zinc-400'}`}>
                    {item.status}
                  </span>
                  <span className="text-text-muted text-xs ml-2">{expanded === item.id ? '▾' : '▸'}</span>
                </button>

                {expanded === item.id && (
                  <div className="px-4 pb-3 pl-12 space-y-2 animate-fade-in">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                      <div><span className="text-text-muted">Tool:</span> <span className="text-text-primary font-mono">{item.toolName}</span></div>
                      <div><span className="text-text-muted">Risk:</span> <span className="text-text-primary">{item.riskExplanation}</span></div>
                      {item.approval && (
                        <>
                          <div><span className="text-text-muted">Approval:</span> <span className="text-text-primary">{item.approval.status}</span></div>
                          {item.approval.approver && <div><span className="text-text-muted">Approver:</span> <span className="text-text-primary">{item.approval.approver}</span></div>}
                        </>
                      )}
                      {item.execution && (
                        <>
                          <div><span className="text-text-muted">Exec Status:</span> <span className="text-text-primary">{item.execution.status}</span></div>
                          {item.execution.exitCode !== null && <div><span className="text-text-muted">Exit Code:</span> <span className="text-text-primary">{item.execution.exitCode}</span></div>}
                        </>
                      )}
                      {item.receipt && (
                        <div className="col-span-2"><span className="text-text-muted">Receipt:</span> <span className="text-text-primary font-mono text-[10px]">{item.receipt.hash.slice(0, 24)}...</span></div>
                      )}
                    </div>
                    {item.args && (
                      <details className="text-xs">
                        <summary className="text-text-muted cursor-pointer hover:text-text-primary">Technical Details</summary>
                        <pre className="mt-1 p-2 bg-surface-0 rounded-lg text-[10px] text-text-muted overflow-x-auto max-h-32">
                          {JSON.stringify(item.args, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {activity && activity.total > 30 && (
        <div className="flex justify-center gap-3">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="px-3 py-1 text-xs bg-surface-2 text-text-muted rounded-lg disabled:opacity-30"
          >
            Previous
          </button>
          <span className="text-xs text-text-muted py-1">
            Page {page} of {Math.ceil(activity.total / 30)}
          </span>
          <button
            onClick={() => setPage(page + 1)}
            disabled={page * 30 >= activity.total}
            className="px-3 py-1 text-xs bg-surface-2 text-text-muted rounded-lg disabled:opacity-30"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
