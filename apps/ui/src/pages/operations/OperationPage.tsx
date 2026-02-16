import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getOperation,
  createRun as apiCreateRun,
  updateOperation,
  getInstances,
  approveOperationRouting,
  routeOperation,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';

export function OperationPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: operation, isLoading } = useQuery({
    queryKey: ['operation', id],
    queryFn: () => getOperation(id!),
    refetchInterval: 5_000,
    enabled: !!id,
  });

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    refetchInterval: 30_000,
  });

  const createRunMut = useMutation({
    mutationFn: () => apiCreateRun({ operationId: id!, recipe: 'ci_replay' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  const updateStatusMut = useMutation({
    mutationFn: (status: string) => updateOperation(id!, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  const approveMut = useMutation({
    mutationFn: () => approveOperationRouting(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  const assignMut = useMutation({
    mutationFn: (instanceId: string) => routeOperation(id!, instanceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operation', id] }),
  });

  if (isLoading || !operation) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  const runs = operation.runs ?? [];
  const assignedAgent = (instances ?? []).find((i: any) => i.id === operation.instanceId);

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/operations" className="text-xs text-text-tertiary hover:text-accent mb-4 inline-block">
        ← Back to Operations
      </Link>

      {/* Routing Section */}
      {(operation.routingStatus === 'pending' && operation.instanceId) && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium text-amber-400">Routing: Pending Approval</p>
              <p className="text-[11px] text-text-secondary mt-0.5">
                Best match: <strong>{assignedAgent?.name ?? 'Unknown Agent'}</strong>
                {operation.routingConfidence != null && ` (${Math.round(operation.routingConfidence * 100)}% confidence)`}
              </p>
              {operation.routingReason && (
                <p className="text-[10px] text-text-tertiary mt-0.5">{operation.routingReason}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => approveMut.mutate()}>
                Approve {assignedAgent?.name}
              </Button>
              {/* Assign to different agent */}
              {(instances ?? []).filter((i: any) => i.status === 'running' && i.id !== operation.instanceId).length > 0 && (
                <select
                  className="text-[11px] bg-surface-2 border border-border rounded px-2 py-1 text-text-primary"
                  defaultValue=""
                  onChange={(e) => e.target.value && assignMut.mutate(e.target.value)}
                >
                  <option value="">Assign to...</option>
                  {(instances ?? []).filter((i: any) => i.status === 'running' && i.id !== operation.instanceId).map((inst: any) => (
                    <option key={inst.id} value={inst.id}>{inst.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Auto-routed banner */}
      {(operation.routingStatus === 'auto_routed' || operation.routingStatus === 'approved' || operation.routingStatus === 'manual') && operation.instanceId && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-4 py-2.5 mb-4 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <p className="text-[11px] text-emerald-400">
            Routed to <strong>{assignedAgent?.name ?? 'Agent'}</strong>
            {operation.routingConfidence != null && ` (${Math.round(operation.routingConfidence * 100)}%)`}
            {operation.routingReason && ` — ${operation.routingReason}`}
          </p>
        </div>
      )}

      {/* Unassigned banner */}
      {operation.routingStatus === 'pending' && !operation.instanceId && (
        <div className="bg-zinc-500/10 border border-zinc-500/30 rounded-lg px-4 py-2.5 mb-4">
          <p className="text-[11px] text-text-secondary mb-2">
            {operation.routingReason || 'No active agents matched. Assign an agent manually.'}
          </p>
          {(instances ?? []).filter((i: any) => i.status === 'running').length > 0 ? (
            <div className="flex gap-2">
              {(instances ?? []).filter((i: any) => i.status === 'running').map((inst: any) => (
                <Button key={inst.id} size="xs" variant="secondary" onClick={() => assignMut.mutate(inst.id)}>
                  Assign to {inst.name}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-[10px] text-text-tertiary">No active agents. Start an agent to handle this operation.</p>
          )}
        </div>
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
              {operation.priority}
            </span>
            <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
              {operation.status}
            </span>
            <span className="text-[10px] text-text-tertiary">
              Triggered by sensor: {operation.source}
            </span>
          </div>
          <h1 className="text-lg font-semibold text-text-primary">{operation.title}</h1>
          {operation.summary && (
            <p className="text-xs text-text-secondary mt-1">{operation.summary}</p>
          )}
        </div>

        <div className="flex gap-2">
          {operation.status !== 'resolved' && (
            <Button size="sm" variant="secondary" onClick={() => updateStatusMut.mutate('resolved')}>
              Resolve
            </Button>
          )}
          <Button size="sm" onClick={() => createRunMut.mutate()} disabled={createRunMut.isPending}>
            {createRunMut.isPending ? 'Creating...' : 'New Run'}
          </Button>
        </div>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {operation.repoFullName && (
          <MetaCard label="Repository" value={operation.repoFullName} />
        )}
        {operation.branch && (
          <MetaCard label="Branch" value={operation.branch} />
        )}
        {operation.commitSha && (
          <MetaCard label="Commit" value={operation.commitSha.slice(0, 8)} />
        )}
      </div>

      {/* Runs */}
      <h2 className="text-sm font-medium text-text-primary mb-3">Runs ({runs.length})</h2>
      {runs.length === 0 ? (
        <div className="text-xs text-text-tertiary bg-surface-1 border border-border rounded-lg p-6 text-center">
          No runs yet. Click "New Run" to start working on this operation.
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run: any) => (
            <Link
              key={run.id}
              to={`/runs/${run.id}`}
              className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-1 border border-border hover:border-accent/30 hover:bg-surface-2 transition-all"
            >
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-text-muted">{run.id.slice(0, 8)}</span>
                <RunStatusBadge status={run.status} />
                <span className="text-[11px] text-text-secondary">Attempt {run.attempt}</span>
              </div>
              <div className="flex items-center gap-3 text-[10px] text-text-tertiary">
                <span>{run._count?.proposals ?? 0} proposals</span>
                <span>{run._count?.evidenceBundles ?? 0} evidence</span>
                <span>{run.spentCents}¢ / {run.budgetCents}¢</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Timeline */}
      <h2 className="text-sm font-medium text-text-primary mb-3 mt-8">Timeline</h2>
      <div className="border-l-2 border-border pl-4 space-y-3">
        <TimelineEntry
          time={operation.createdAt}
          label={`Operation created via ${operation.source}`}
        />
        {operation.routingStatus !== 'pending' && operation.instanceId && (
          <TimelineEntry
            time={operation.updatedAt}
            label={`Routed to ${assignedAgent?.name ?? 'agent'} (${operation.routingStatus})`}
          />
        )}
        {runs.map((run: any) => (
          <TimelineEntry
            key={run.id}
            time={run.createdAt}
            label={`Run ${run.id.slice(0, 8)} created (attempt ${run.attempt})`}
          />
        ))}
      </div>
    </div>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-1 border border-border rounded-lg px-4 py-3">
      <p className="text-[10px] text-text-tertiary uppercase tracking-wider">{label}</p>
      <p className="text-sm font-mono text-text-primary mt-0.5 truncate">{value}</p>
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

function TimelineEntry({ time, label }: { time: string; label: string }) {
  const date = new Date(time);
  return (
    <div className="relative">
      <div className="absolute -left-[21px] top-1.5 w-2 h-2 rounded-full bg-accent/50" />
      <p className="text-[11px] text-text-secondary">{label}</p>
      <p className="text-[10px] text-text-tertiary">{date.toLocaleString()}</p>
    </div>
  );
}
