/**
 * Audit Trail — Auto-loads last 7 days, chain integrity prominent, better empty state.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getAuditReport,
  getChainIntegrity,
  getAuditReportCsv,
  type AuditReport,
  type ChainIntegrity,
} from '../../api/client.ts';
import { Tooltip } from '../../components/common/Tooltip.tsx';

const riskBadge: Record<string, string> = {
  READ: 'text-blue-400 bg-blue-500/10',
  WRITE: 'text-amber-400 bg-amber-500/10',
  DESTRUCTIVE: 'text-red-400 bg-red-500/10',
};

export function AuditPage() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [from, setFrom] = useState(weekAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(now.toISOString().slice(0, 10));

  // Auto-load on mount with last 7 days
  const { data: report, isLoading, refetch } = useQuery<AuditReport>({
    queryKey: ['audit-report', from, to],
    queryFn: () => getAuditReport(from, to),
    enabled: true,
    refetchInterval: 30_000,
  });

  const { data: chain } = useQuery<ChainIntegrity>({
    queryKey: ['chain-integrity', from, to],
    queryFn: () => getChainIntegrity(from, to),
    enabled: true,
    refetchInterval: 30_000,
  });

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
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wooblay-audit-${from}-${to}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text-primary">Audit Trail</h1>
        <p className="text-sm text-text-muted mt-1">
          Compliance-ready reports with cryptographic chain verification.
        </p>
      </div>

      {/* Chain Integrity — Prominent */}
      <div className={`rounded-xl border p-4 flex items-center gap-4 ${
        chain
          ? chain.chainValid
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : 'bg-red-500/5 border-red-500/20'
          : 'bg-surface-1 border-border'
      }`}>
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold ${
          chain
            ? chain.chainValid
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
            : 'bg-surface-3 text-text-muted'
        }`}>
          {chain ? (chain.chainValid ? '✓' : '✗') : '?'}
        </div>
        <div>
          <Tooltip content="Cryptographic hash chain ensures no audit records have been tampered with">
            <p className={`text-sm font-medium ${
              chain ? (chain.chainValid ? 'text-emerald-400' : 'text-red-400') : 'text-text-muted'
            }`}>
              {chain ? (chain.chainValid ? 'Chain Verified — No Tampering Detected' : 'Chain Integrity Issues') : 'Loading chain verification...'}
            </p>
          </Tooltip>
          <p className="text-xs text-text-muted">
            {chain
              ? `${chain.totalReceipts} receipts · ${chain.hashesVerified} hashes verified${chain.gaps.length > 0 ? ` · ${chain.gaps.length} gaps` : ''}`
              : 'Verifying cryptographic receipt chain...'}
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-surface-1 border border-border rounded-xl p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[11px] text-text-muted mb-1">From</label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-[11px] text-text-muted mb-1">To</label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-accent hover:bg-accent-bright text-white text-sm rounded-lg transition-colors"
        >
          Refresh
        </button>

        {report && (
          <div className="flex gap-2 ml-auto">
            <button
              onClick={handleDownloadJson}
              className="px-3 py-2 bg-surface-2 hover:bg-surface-3 text-text-primary text-xs rounded-lg border border-border transition-colors"
            >
              JSON
            </button>
            <button
              onClick={handleDownloadCsv}
              className="px-3 py-2 bg-surface-2 hover:bg-surface-3 text-text-primary text-xs rounded-lg border border-border transition-colors"
            >
              CSV
            </button>
          </div>
        )}
      </div>

      {/* Summary Stats */}
      {report && report.summary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total Actions', value: report.summary.totalActions, color: 'text-text-primary' },
            { label: 'Auto-Allowed', value: report.summary.autoAllowed, color: 'text-emerald-400' },
            { label: 'Human Approved', value: report.summary.humanApproved, color: 'text-amber-400' },
            { label: 'Denied', value: report.summary.denied, color: 'text-red-400' },
            { label: 'Avg Approval', value: `${(report.summary.avgApprovalTimeMs / 1000).toFixed(1)}s`, color: 'text-text-primary' },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface-1 border border-border rounded-xl p-3 text-center">
              <div className={`text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</div>
              <div className="text-[10px] text-text-muted mt-0.5">{stat.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Report Table */}
      {isLoading && (
        <div className="p-8 text-center text-text-muted text-sm animate-pulse">Loading audit trail...</div>
      )}

      {report && report.rows.length > 0 && (
        <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Audit Log — {report.rows.length} entries
            </h2>
            <span className="text-[10px] text-text-muted">
              {report.period.from.slice(0, 10)} → {report.period.to.slice(0, 10)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-0 text-text-muted text-[10px] uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Time</th>
                  <th className="text-left px-3 py-2">Action</th>
                  <th className="text-left px-3 py-2">Risk</th>
                  <th className="text-left px-3 py-2">Policy</th>
                  <th className="text-left px-3 py-2">Approval</th>
                  <th className="text-left px-3 py-2">Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.rows.map((row) => (
                  <tr key={row.receiptId} className="hover:bg-surface-2/50 transition-colors">
                    <td className="px-3 py-2 text-text-muted font-mono whitespace-nowrap text-[10px]">
                      {new Date(row.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-3 py-2 text-text-primary max-w-[250px] truncate">
                      {row.description}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${riskBadge[row.riskTier] ?? ''}`}>
                        {row.riskTier}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{row.policyDecision}</td>
                    <td className="px-3 py-2 text-text-secondary">
                      {row.approvalStatus ?? '—'}
                      {row.approver && <span className="text-text-muted ml-1 text-[10px]">({row.approver})</span>}
                    </td>
                    <td className="px-3 py-2">
                      <Tooltip content={`Full hash: ${row.receiptHash}`}>
                        <span className="font-mono text-[9px] text-text-muted">{row.receiptHash.slice(0, 16)}…</span>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {report && report.rows.length === 0 && !isLoading && (
        <div className="bg-surface-1 border border-border rounded-xl p-12 text-center">
          <div className="font-mono text-3xl opacity-10 mb-3">[ ]</div>
          <p className="text-sm font-medium text-text-secondary">No audit activity in this period</p>
          <p className="text-xs text-text-muted mt-1">
            Agent actions will be recorded here with cryptographic receipts once your agent starts working.
          </p>
        </div>
      )}

      {!report && !isLoading && (
        <div className="bg-surface-1 border border-border rounded-xl p-12 text-center">
          <div className="font-mono text-3xl opacity-10 mb-3">_</div>
          <p className="text-sm font-medium text-text-secondary">Loading audit data...</p>
          <p className="text-xs text-text-muted mt-1">Fetching the last 7 days of agent activity.</p>
        </div>
      )}
    </div>
  );
}
