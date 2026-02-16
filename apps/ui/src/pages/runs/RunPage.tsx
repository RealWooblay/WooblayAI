import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getRun, pauseRun, resumeRun, killRun, approveProposal, denyProposal,
  getCaseFile, getVerificationStats, createRollback, getRunRollbacks,
  rerunEvidence,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';
import { useState } from 'react';
import { redactPayload } from '../../utils/redact.ts';

export function RunPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', id],
    queryFn: () => getRun(id!),
    refetchInterval: 5_000,
    enabled: !!id,
  });

  const pauseMut = useMutation({
    mutationFn: () => pauseRun(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', id] }),
  });
  const resumeMut = useMutation({
    mutationFn: () => resumeRun(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', id] }),
  });
  const killMut = useMutation({
    mutationFn: () => killRun(id!, 'Manual kill'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', id] }),
  });

  const exportMut = useMutation({
    mutationFn: () => getCaseFile(id!),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wooblay-case-${id!.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  const { data: verifyStats } = useQuery({
    queryKey: ['verification-stats', id],
    queryFn: () => getVerificationStats(id!),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const { data: rollbacks } = useQuery({
    queryKey: ['rollbacks', id],
    queryFn: () => getRunRollbacks(id!),
    enabled: !!id,
  });

  if (isLoading || !run) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  const proposals = run.proposals ?? [];
  const events = run.runEvents ?? [];
  const evidence = run.evidenceBundles ?? [];
  const isActive = ['running', 'scheduled', 'paused'].includes(run.status);

  return (
    <div className="max-w-4xl mx-auto">
      <Link to={`/operations/${run.operationId || run.incidentId}`} className="text-xs text-text-tertiary hover:text-accent mb-4 inline-block">
        ← Back to Operation
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-text-muted">{run.id.slice(0, 12)}</span>
            <RunStatusBadge status={run.status} />
            <span className="text-[10px] text-text-tertiary">{run.priority}</span>
          </div>
          <h1 className="text-lg font-semibold text-text-primary">
            Run #{run.attempt} — {run.operation?.title ?? run.operationId ?? run.incidentId}
          </h1>
        </div>

        <div className="flex gap-2">
          {run.status === 'running' && (
            <Button size="sm" variant="secondary" onClick={() => pauseMut.mutate()}>Pause</Button>
          )}
          {run.status === 'paused' && (
            <Button size="sm" onClick={() => resumeMut.mutate()}>Resume</Button>
          )}
          {isActive && (
            <Button size="sm" variant="danger" onClick={() => killMut.mutate()}>Kill</Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => exportMut.mutate()}>
            Export Case File
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-8">
        <StatCard label="Budget" value={`${run.spentCents}¢ / ${run.budgetCents}¢`} />
        <StatCard label="Proposals" value={String(proposals.length)} />
        <StatCard label="Evidence" value={String(evidence.length)} />
        <StatCard label="Verifications" value={verifyStats ? `${verifyStats.passed}/${verifyStats.total}` : '—'} />
        <StatCard label="Events" value={String(events.length)} />
      </div>

      {/* Verification Summary */}
      {verifyStats && verifyStats.total > 0 && (
        <div className="bg-surface-1 border border-border rounded-lg px-4 py-3 mb-6">
          <h3 className="text-xs font-medium text-text-primary mb-2">Post-Action Verification</h3>
          <div className="flex gap-4 text-[11px]">
            <span className="text-emerald-400">Passed: {verifyStats.passed}</span>
            <span className="text-red-400">Failed: {verifyStats.failed}</span>
            <span className="text-zinc-400">Skipped: {verifyStats.skipped}</span>
            {verifyStats.passRate !== null && (
              <span className="text-text-secondary">
                Pass rate: {(verifyStats.passRate * 100).toFixed(0)}%
              </span>
            )}
          </div>
        </div>
      )}

      {/* Proposals */}
      <h2 className="text-sm font-medium text-text-primary mb-3">Proposals</h2>
      {proposals.length === 0 ? (
        <div className="text-xs text-text-tertiary bg-surface-1 border border-border rounded-lg p-6 text-center">
          No proposals yet.
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {proposals.map((p: any) => (
            <ProposalCard key={p.id} proposal={p} runId={id!} />
          ))}
        </div>
      )}

      {/* Evidence Bundles */}
      {evidence.length > 0 && (
        <>
          <h2 className="text-sm font-medium text-text-primary mb-3 mt-6">Evidence Bundles</h2>
          <div className="space-y-2 mb-8">
            {evidence.map((eb: any) => (
              <EvidenceCard key={eb.id} bundle={eb} />
            ))}
          </div>
        </>
      )}

      {/* Rollbacks */}
      {(rollbacks?.length ?? 0) > 0 && (
        <>
          <h2 className="text-sm font-medium text-text-primary mb-3 mt-6">Rollbacks</h2>
          <div className="space-y-2 mb-8">
            {rollbacks!.map((r: any) => (
              <div key={r.id} className="bg-surface-1 border border-border rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-mono text-text-primary">{r.type}</span>
                  <ProposalStatusBadge status={r.status} />
                </div>
                {r.originalProposalId && (
                  <p className="text-[10px] text-text-tertiary">
                    Rollback of: {r.originalProposalId.slice(0, 12)}...
                  </p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/* Timeline */}
      <h2 className="text-sm font-medium text-text-primary mb-3 mt-6">Timeline ({events.length} events)</h2>
      <div className="border-l-2 border-border pl-4 space-y-2 max-h-[400px] overflow-y-auto">
        {events.map((e: any) => {
          const rawData = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
          const eventData = redactPayload(rawData);
          return (
            <div key={e.id} className="relative">
              <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-accent/40" />
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">{e.type}</span>
                <span className="text-[10px] text-text-tertiary">#{e.sequenceNum}</span>
              </div>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {JSON.stringify(eventData).slice(0, 120)}
              </p>
              <p className="text-[10px] text-text-tertiary">{new Date(e.timestamp).toLocaleString()}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg px-4 py-3">
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono text-text-primary mt-0.5">{value}</p>
    </div>
  );
}

function ProposalCard({ proposal, runId }: { proposal: any; runId: string }) {
  const qc = useQueryClient();
  const [showSnapshot, setShowSnapshot] = useState(false);

  const approveMut = useMutation({
    mutationFn: () => approveProposal(proposal.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const denyMut = useMutation({
    mutationFn: () => denyProposal(proposal.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run', runId] }),
  });
  const rollbackMut = useMutation({
    mutationFn: () => createRollback(runId, {
      originalProposalId: proposal.id,
      type: 'rollback:capability_revoke',
      reason: 'Manual rollback from UI',
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['run', runId] });
      qc.invalidateQueries({ queryKey: ['rollbacks', runId] });
    },
  });

  const riskColors: Record<string, string> = {
    low: 'text-emerald-400',
    medium: 'text-amber-400',
    high: 'text-orange-400',
    critical: 'text-red-400',
  };

  const policySnapshot = proposal.policySnapshot
    ? (typeof proposal.policySnapshot === 'string' ? JSON.parse(proposal.policySnapshot) : proposal.policySnapshot)
    : null;

  const isRollback = proposal.actionClass?.startsWith('rollback:');

  return (
    <div className={`bg-surface-1 border rounded-lg px-4 py-3 ${isRollback ? 'border-red-500/30' : 'border-border'}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isRollback && <span className="text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">ROLLBACK</span>}
          <span className="text-[11px] font-mono text-text-primary">{proposal.actionClass}</span>
          <span className={`text-[10px] font-medium ${riskColors[proposal.riskClass] ?? ''}`}>
            {proposal.riskClass}
          </span>
          {proposal.irreversible && (
            <span className="text-[10px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">irreversible</span>
          )}
          <ProposalStatusBadge status={proposal.status} />
          {proposal.verificationId && (
            <span className="text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">verified</span>
          )}
        </div>
        <div className="flex gap-2">
          {proposal.status === 'pending' && (
            <>
              <Button size="xs" onClick={() => approveMut.mutate()}>Approve</Button>
              <Button size="xs" variant="danger" onClick={() => denyMut.mutate()}>Deny</Button>
            </>
          )}
          {(proposal.status === 'executed' || proposal.status === 'verified') && !isRollback && (
            <Button size="xs" variant="secondary" onClick={() => rollbackMut.mutate()}>
              Rollback
            </Button>
          )}
        </div>
      </div>

      <p className="text-[11px] text-text-secondary">
        Tool: {proposal.toolName} | Args hash: {proposal.argsHash?.slice(0, 12)}...
      </p>

      {/* Approver identity */}
      {proposal.approver && (
        <p className="text-[10px] text-text-tertiary mt-1">
          Approved by: {proposal.approverEmail ?? proposal.approver}
          {proposal.approverRole && ` (${proposal.approverRole})`}
          {proposal.approvedAt && ` at ${new Date(proposal.approvedAt).toLocaleString()}`}
        </p>
      )}

      {proposal.compensatingAction && (
        <p className="text-[10px] text-text-tertiary mt-1">
          Compensating action: {proposal.compensatingAction}
        </p>
      )}

      {/* Policy snapshot toggle */}
      {policySnapshot && (
        <div className="mt-2">
          <button
            onClick={() => setShowSnapshot(!showSnapshot)}
            className="text-[10px] text-accent hover:underline"
          >
            {showSnapshot ? 'Hide' : 'Show'} policy snapshot
          </button>
          {showSnapshot && (
            <pre className="text-[10px] text-text-tertiary mt-1 bg-surface-0 p-2 rounded font-mono overflow-x-auto">
              {JSON.stringify(policySnapshot, null, 2)}
            </pre>
          )}
        </div>
      )}

      {proposal.evidenceBundle && (
        <div className="mt-2 pt-2 border-t border-border">
          <p className="text-[10px] text-text-tertiary">
            Evidence: {proposal.evidenceBundle.recipeType} — {proposal.evidenceBundle.status}
            {proposal.evidenceBundle.reproducible && ' (reproducible)'}
          </p>
        </div>
      )}
    </div>
  );
}

function EvidenceCard({ bundle }: { bundle: any }) {
  const diff = bundle.structuredDiff ? (typeof bundle.structuredDiff === 'string' ? JSON.parse(bundle.structuredDiff) : bundle.structuredDiff) : null;
  const [rerunning, setRerunning] = useState(false);

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await rerunEvidence(bundle.id);
    } catch {
      // Non-critical
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="bg-surface-1 border border-border rounded-lg px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono text-text-muted">{bundle.id.slice(0, 8)}</span>
        <span className="text-[10px] font-medium text-accent">{bundle.recipeType}</span>
        <EvidenceStatusBadge status={bundle.status} />
        {bundle.reproducible && (
          <span className="text-[10px] text-emerald-400">reproducible</span>
        )}
        {bundle.status === 'completed' && (
          <button
            onClick={handleRerun}
            disabled={rerunning}
            className="ml-auto text-[10px] text-accent hover:text-accent-bright border border-accent/30 px-2 py-0.5 rounded hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            {rerunning ? 'Re-running...' : 'Re-run'}
          </button>
        )}
      </div>

      {diff && (
        <div className="mt-2 text-[11px] font-mono">
          {diff.newFailures?.length > 0 && (
            <p className="text-red-400">New failures: {diff.newFailures.join(', ')}</p>
          )}
          {diff.fixedTests?.length > 0 && (
            <p className="text-emerald-400">Fixed: {diff.fixedTests.join(', ')}</p>
          )}
          <p className="text-text-tertiary mt-1">
            Base: exit {diff.baseTestResult?.exitCode} ({diff.baseTestResult?.durationMs}ms) |
            Head: exit {diff.headTestResult?.exitCode} ({diff.headTestResult?.durationMs}ms)
          </p>
        </div>
      )}

      <div className="flex gap-4 mt-2 text-[10px] text-text-tertiary">
        {bundle.environmentHash && <span>Env: {bundle.environmentHash.slice(0, 8)}...</span>}
        {bundle.inputsHash && <span>In: {bundle.inputsHash.slice(0, 8)}...</span>}
        {bundle.outputsHash && <span>Out: {bundle.outputsHash.slice(0, 8)}...</span>}
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-zinc-500/15 text-zinc-400',
    scheduled: 'bg-blue-500/15 text-blue-400',
    running: 'bg-green-500/15 text-green-400',
    paused: 'bg-amber-500/15 text-amber-400',
    completed: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
    quarantined: 'bg-red-500/15 text-red-400',
    cancelled: 'bg-zinc-500/15 text-zinc-400',
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}

function ProposalStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-400',
    approved: 'bg-emerald-500/15 text-emerald-400',
    denied: 'bg-red-500/15 text-red-400',
    executed: 'bg-blue-500/15 text-blue-400',
    verified: 'bg-emerald-500/15 text-emerald-400',
    rolled_back: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}

function EvidenceStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-zinc-500/15 text-zinc-400',
    running: 'bg-blue-500/15 text-blue-400',
    completed: 'bg-emerald-500/15 text-emerald-400',
    failed: 'bg-red-500/15 text-red-400',
  };
  return (
    <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}
