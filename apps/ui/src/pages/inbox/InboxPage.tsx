import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getIncidents } from '../../api/client.ts';
import { Badge } from '../../components/common/Badge.tsx';
import { Spinner } from '../../components/common/Spinner.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2 };
const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-500/15 text-red-400 border-red-500/30',
  P1: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  P2: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  triaging: 'Triaging',
  in_progress: 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export function InboxPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['incidents'],
    queryFn: () => getIncidents({ limit: 100 }),
    refetchInterval: 10_000,
  });

  const incidents = data?.incidents ?? [];
  const active = incidents.filter((i: any) => !['resolved', 'closed'].includes(i.status));
  const resolved = incidents.filter((i: any) => ['resolved', 'closed'].includes(i.status));

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Inbox</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {active.length} active incident{active.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {active.length === 0 && resolved.length === 0 && (
        <EmptyState message="No incidents yet. Connect a GitHub repo and sensors will detect CI failures automatically." />
      )}

      {active.length > 0 && (
        <div className="space-y-2 mb-8">
          {active.map((incident: any) => (
            <IncidentRow key={incident.id} incident={incident} />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <h2 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 mt-8">
            Resolved ({resolved.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {resolved.slice(0, 10).map((incident: any) => (
              <IncidentRow key={incident.id} incident={incident} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function IncidentRow({ incident }: { incident: any }) {
  const latestRun = incident.runs?.[0];
  const timeAgo = formatTimeAgo(incident.createdAt);

  return (
    <Link
      to={`/incidents/${incident.id}`}
      className="flex items-center gap-4 px-4 py-3 rounded-lg bg-surface-1 border border-border hover:border-accent/30 hover:bg-surface-2 transition-all group"
    >
      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[incident.priority] ?? PRIORITY_COLORS.P2}`}>
        {incident.priority}
      </span>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-text-primary truncate group-hover:text-accent-bright transition-colors">
            {incident.title}
          </p>
          {incident.intent && incident.intent !== 'fix' && (
            <IntentBadge intent={incident.intent} />
          )}
        </div>
        {incident.summary && (
          <p className="text-[11px] text-text-tertiary truncate mt-0.5">{incident.summary}</p>
        )}
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {latestRun && (
          <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
            {latestRun.status}
          </span>
        )}
        <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
          {STATUS_LABELS[incident.status] ?? incident.status}
        </span>
        <span className="text-[10px] text-text-tertiary tabular-nums">{timeAgo}</span>
      </div>
    </Link>
  );
}

const INTENT_COLORS: Record<string, string> = {
  fix: 'bg-red-500/15 text-red-400',
  qa: 'bg-blue-500/15 text-blue-400',
  review: 'bg-purple-500/15 text-purple-400',
  deploy: 'bg-emerald-500/15 text-emerald-400',
  custom: 'bg-zinc-500/15 text-zinc-400',
};

function IntentBadge({ intent }: { intent: string }) {
  return (
    <span className={`text-[9px] font-medium uppercase px-1.5 py-0.5 rounded ${INTENT_COLORS[intent] ?? INTENT_COLORS.custom}`}>
      {intent}
    </span>
  );
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
