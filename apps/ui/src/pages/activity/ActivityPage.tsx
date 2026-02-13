/**
 * Activity — Unified activity log + compliance audit on one page.
 *
 * Top:    Chain integrity banner + session stats + export buttons
 * Middle: Anomaly flags (if any)
 * Filter: Date range + risk/status selectors
 * Main:   Action log with expandable details
 * Bottom: Pagination
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getActivity,
  getFlags,
  dismissFlag,
  getInstances,
  getInstanceContributions,
  getAuditReport,
  getChainIntegrity,
  getAuditReportCsv,
  type ActivityItem,
  type AuditFlag,
  type AuditReport,
  type ChainIntegrity,
} from '../../api/client.ts';
import { Tooltip } from '../../components/common/Tooltip.tsx';

// ── Color maps ───────────────────────────────────────────────────────────────

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
  CRITICAL: 'bg-red-500/10 text-red-400 border-red-500/20',
  HIGH: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  MEDIUM: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  LOW: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  INFO: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
};

// ── Main ─────────────────────────────────────────────────────────────────────

export function ActivityPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [riskFilter, setRiskFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Date range for audit / export
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [from, setFrom] = useState(weekAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));

  // ── Queries ──────────────────────────────────────────────────────────────

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

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    refetchInterval: 30_000,
  });

  const runningInstance = instances?.find(i => i.status === 'running');
  const { data: contributions } = useQuery({
    queryKey: ['contributions', runningInstance?.id],
    queryFn: () => getInstanceContributions(runningInstance!.id),
    enabled: !!runningInstance,
    refetchInterval: 30_000,
  });

  const { data: auditReport } = useQuery<AuditReport>({
    queryKey: ['audit-report', from, to],
    queryFn: () => getAuditReport(from, to),
    refetchInterval: 30_000,
  });

  const { data: chain } = useQuery<ChainIntegrity>({
    queryKey: ['chain-integrity', from, to],
    queryFn: () => getChainIntegrity(from, to),
    refetchInterval: 30_000,
  });

  const dismissMutation = useMutation({
    mutationFn: dismissFlag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });

  // ── Derived ──────────────────────────────────────────────────────────────

  const flags = flagsData?.flags ?? [];
  const flagSummary = flagsData?.summary ?? {};
  const totalFlags = Object.values(flagSummary).reduce((a, b) => a + b, 0);
  const totalItems = activity?.data?.length ?? 0;
  const deniedCount = activity?.data?.filter(a => a.status === 'denied').length ?? 0;
  const allowedCount = activity?.data?.filter(a => a.status === 'allowed' || a.status === 'auto-allowed').length ?? 0;
  const approvedCount = activity?.data?.filter(a => a.status === 'approved').length ?? 0;

  // ── Export handlers ──────────────────────────────────────────────────────

  const handleDownloadCsv = async () => {
    try {
      const csv = await getAuditReportCsv(from, to);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wooblay-audit-${from}-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download CSV:', err);
    }
  };

  const handleDownloadJson = () => {
    if (!auditReport) return;
    const blob = new Blob([JSON.stringify(auditReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wooblay-audit-${from}-${to}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-4">
      {/* ── Header + Export ───────────────────────────────────────────────── */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Activity</h1>
          <p className="text-sm text-text-muted mt-0.5">Agent actions, AI detections, and compliance</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleDownloadJson}
            disabled={!auditReport}
            className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-text-primary text-[10px] rounded-lg border border-border transition-colors disabled:opacity-30"
          >
            Export JSON
          </button>
          <button
            onClick={handleDownloadCsv}
            className="px-3 py-1.5 bg-surface-2 hover:bg-surface-3 text-text-primary text-[10px] rounded-lg border border-border transition-colors"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* ── Chain Integrity ───────────────────────────────────────────────── */}
      <div className={`rounded-xl border p-3 flex items-center gap-3 ${
        chain
          ? chain.chainValid
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : 'bg-red-500/5 border-red-500/20'
          : 'bg-surface-1 border-border'
      }`}>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
          chain
            ? chain.chainValid
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
            : 'bg-surface-3 text-text-muted'
        }`}>
          {chain ? (chain.chainValid ? '✓' : '✗') : '?'}
        </div>
        <div className="min-w-0">
          <Tooltip content="Cryptographic hash chain ensures no audit records have been tampered with. Every action receipt is cryptographically linked to the previous one — any tampering breaks the chain.">
            <p className={`text-xs font-medium cursor-help ${
              chain ? (chain.chainValid ? 'text-emerald-400' : 'text-red-400') : 'text-text-muted'
            }`}>
              {chain ? (chain.chainValid ? 'Chain Verified — No Tampering ⓘ' : 'Chain Integrity Issues ⓘ') : 'Verifying chain...'}
            </p>
          </Tooltip>
          <p className="text-[10px] text-text-muted">
            {chain
              ? `${chain.totalReceipts} receipts · ${chain.hashesVerified} verified${chain.gaps.length > 0 ? ` · ${chain.gaps.length} gaps` : ''}`
              : 'Checking cryptographic receipts...'}
          </p>
        </div>
      </div>

      {/* ── Session Summary ───────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div>
            <div className="text-[10px] text-text-muted">Total Actions</div>
            <div className="text-xl font-bold text-text-primary tabular-nums">{auditReport?.summary?.totalActions ?? totalItems}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted">Auto-Allowed</div>
            <div className="text-xl font-bold text-emerald-400 tabular-nums">{auditReport?.summary?.autoAllowed ?? allowedCount}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted">Human Approved</div>
            <div className="text-xl font-bold text-yellow-400 tabular-nums">{auditReport?.summary?.humanApproved ?? approvedCount}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-muted">Denied</div>
            <div className="text-xl font-bold text-red-400 tabular-nums">{auditReport?.summary?.denied ?? deniedCount}</div>
          </div>
          <Tooltip content="Average time for human to approve a pending action">
            <div>
              <div className="text-[10px] text-text-muted">Avg Approval</div>
              <div className="text-xl font-bold text-text-primary tabular-nums">
                {auditReport?.summary ? `${(auditReport.summary.avgApprovalTimeMs / 1000).toFixed(1)}s` : '—'}
              </div>
            </div>
          </Tooltip>
          <Tooltip content="Number of AI-detected anomalies requiring attention">
            <div>
              <div className="text-[10px] text-text-muted">AI Flags</div>
              <div className={`text-xl font-bold tabular-nums ${totalFlags > 0 ? 'text-red-400' : 'text-text-primary'}`}>{totalFlags}</div>
            </div>
          </Tooltip>
        </div>

        {contributions && (
          <div className="mt-3 pt-3 border-t border-border flex gap-6 text-[10px] text-text-muted">
            <span>{contributions.summary.filesCreated} files created</span>
            <span>{contributions.summary.filesEdited} files edited</span>
            <span>{contributions.summary.commandsExecuted} commands</span>
            <span>{contributions.summary.linesWritten} lines written</span>
            <span className="ml-auto text-text-secondary">Efficiency: {contributions.summary.approvalEfficiency}</span>
          </div>
        )}
      </div>

      {/* ── Anomaly Flags ─────────────────────────────────────────────────── */}
      {totalFlags > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">Detected Anomalies</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {flags.slice(0, 6).map((flag: AuditFlag) => (
              <div key={flag.id} className={`rounded-xl border p-3 ${severityColor[flag.severity] ?? ''}`}>
                <div className="min-w-0 mb-2">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] font-bold uppercase">{flag.severity}</span>
                    <span className="text-[9px] opacity-50">{flag.category.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-xs font-medium">{flag.title}</p>
                  <p className="text-[10px] opacity-70 mt-0.5 line-clamp-2">{flag.description}</p>
                </div>
                <div className="flex items-center gap-2 pt-2 border-t border-white/5">
                  {flag.severity === 'CRITICAL' || flag.severity === 'HIGH' ? (
                    <Link to="/policies" className="text-[10px] font-medium hover:underline">
                      Update policies →
                    </Link>
                  ) : (
                    <Link to="/approvals" className="text-[10px] font-medium hover:underline">
                      Review approvals →
                    </Link>
                  )}
                  <button
                    onClick={() => dismissMutation.mutate(flag.id)}
                    className="text-[10px] opacity-40 hover:opacity-100 ml-auto"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-[10px] text-text-muted mb-0.5">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent" />
        </div>
        <div>
          <label className="block text-[10px] text-text-muted mb-0.5">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent" />
        </div>
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

      {/* ── Action Log ────────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">Action Log</h2>
          {activity && <span className="text-[10px] text-text-tertiary">{activity.total} total</span>}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-text-muted text-sm animate-pulse">Loading activity...</div>
        ) : !activity?.data.length ? (
          <div className="p-12 text-center">
            <div className="font-mono text-3xl opacity-10 mb-3">_</div>
            <p className="text-sm text-text-muted">No activity recorded yet.</p>
            <p className="text-xs text-text-muted mt-1">Agent actions will appear here once your agent starts working.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activity.data.map((item: ActivityItem) => (
              <div key={item.id}>
                <button
                  onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                  className="w-full text-left px-4 py-2.5 hover:bg-surface-2/50 transition-colors flex items-center gap-3"
                >
                  <span className="text-[10px] text-text-muted w-[65px] shrink-0 font-mono">
                    {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${riskColor[item.riskTier] ?? 'text-zinc-400'}`}>
                    {item.riskTier}
                  </span>
                  <span className="text-xs text-text-primary flex-1 truncate">
                    {item.humanDescription}
                  </span>
                  <span className={`text-[10px] font-medium ${statusColor[item.status] ?? 'text-zinc-400'}`}>
                    {item.status}
                  </span>
                </button>

                {expanded === item.id && (
                  <div className="px-4 pb-3 pl-[90px] space-y-2 animate-fade-in">
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
                          <div><span className="text-text-muted">Exec:</span> <span className="text-text-primary">{item.execution.status}</span></div>
                          {item.execution.exitCode !== null && <div><span className="text-text-muted">Exit:</span> <span className="text-text-primary">{item.execution.exitCode}</span></div>}
                        </>
                      )}
                      {item.receipt && (
                        <div className="col-span-2">
                          <span className="text-text-muted">Receipt:</span>{' '}
                          <Tooltip content={`Full hash: ${item.receipt.hash}`}>
                            <span className="text-text-primary font-mono text-[10px]">{item.receipt.hash.slice(0, 24)}…</span>
                          </Tooltip>
                        </div>
                      )}
                    </div>
                    {item.args && (
                      <details className="text-xs">
                        <summary className="text-text-muted cursor-pointer hover:text-text-primary">Raw args</summary>
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

      {/* ── Pagination ────────────────────────────────────────────────────── */}
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
