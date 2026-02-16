import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getIncident, createRun as apiCreateRun, updateIncident } from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { Button } from '../../components/common/Button.tsx';

export function IncidentPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: incident, isLoading } = useQuery({
    queryKey: ['incident', id],
    queryFn: () => getIncident(id!),
    refetchInterval: 5_000,
    enabled: !!id,
  });

  const createRunMut = useMutation({
    mutationFn: () => apiCreateRun({ incidentId: id!, recipe: 'ci_replay' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incident', id] }),
  });

  const updateStatusMut = useMutation({
    mutationFn: (status: string) => updateIncident(id!, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incident', id] }),
  });

  if (isLoading || !incident) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  const runs = incident.runs ?? [];

  return (
    <div className="max-w-4xl mx-auto">
      <Link to="/inbox" className="text-xs text-text-tertiary hover:text-accent mb-4 inline-block">
        ← Back to Inbox
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-amber-500/15 text-amber-400 border-amber-500/30">
              {incident.priority}
            </span>
            <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
              {incident.status}
            </span>
            <span className="text-[10px] text-text-tertiary">{incident.source}</span>
          </div>
          <h1 className="text-lg font-semibold text-text-primary">{incident.title}</h1>
          {incident.summary && (
            <p className="text-xs text-text-secondary mt-1">{incident.summary}</p>
          )}
        </div>

        <div className="flex gap-2">
          {incident.status !== 'resolved' && (
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
        {incident.repoFullName && (
          <MetaCard label="Repository" value={incident.repoFullName} />
        )}
        {incident.branch && (
          <MetaCard label="Branch" value={incident.branch} />
        )}
        {incident.commitSha && (
          <MetaCard label="Commit" value={incident.commitSha.slice(0, 8)} />
        )}
      </div>

      {/* Runs */}
      <h2 className="text-sm font-medium text-text-primary mb-3">Runs ({runs.length})</h2>
      {runs.length === 0 ? (
        <div className="text-xs text-text-tertiary bg-surface-1 border border-border rounded-lg p-6 text-center">
          No runs yet. Click "New Run" to start investigating this incident.
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
          time={incident.createdAt}
          label={`Incident created via ${incident.source}`}
        />
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
