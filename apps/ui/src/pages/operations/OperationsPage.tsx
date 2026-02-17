import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getOperations,
  getInstances,
  approveOperationRouting,
  routeOperation,
  dismissOperation,
} from '../../api/client.ts';
import { Spinner } from '../../components/common/Spinner.tsx';
import { EmptyState } from '../../components/common/EmptyState.tsx';
import { Button } from '../../components/common/Button.tsx';

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

export function OperationsPage() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['operations'],
    queryFn: () => getOperations({ limit: 100 }),
    refetchInterval: 10_000,
  });

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    refetchInterval: 30_000,
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => approveOperationRouting(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operations'] }),
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => dismissOperation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operations'] }),
  });

  const assignMut = useMutation({
    mutationFn: ({ opId, instanceId }: { opId: string; instanceId: string }) =>
      routeOperation(opId, instanceId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operations'] }),
  });

  const operations = data?.operations ?? [];
  const active = operations.filter((i: any) => !['resolved', 'closed'].includes(i.status));
  const resolved = operations.filter((i: any) => ['resolved', 'closed'].includes(i.status));

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner /></div>;
  }

  return (
    <div className="max-w-4xl mx-auto" data-tour="tour-operations">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Operations</h1>
          <p className="text-xs text-text-tertiary mt-0.5">
            {active.length} active operation{active.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {active.length === 0 && resolved.length === 0 && (
        <EmptyState
          title="No active operations"
          description="Configure connections to start monitoring. Operations are created when connections detect events."
        />
      )}

      {active.length > 0 && (
        <div className="space-y-2 mb-8" data-tour="tour-operations-list">
          {active.map((op: any) => (
            <OperationRow
              key={op.id}
              operation={op}
              instances={instances ?? []}
              onApprove={() => approveMut.mutate(op.id)}
              onDismiss={() => dismissMut.mutate(op.id)}
              onAssign={(instanceId) => assignMut.mutate({ opId: op.id, instanceId })}
            />
          ))}
        </div>
      )}

      {resolved.length > 0 && (
        <>
          <h2 className="text-xs font-medium text-text-tertiary uppercase tracking-wider mb-3 mt-8">
            Resolved ({resolved.length})
          </h2>
          <div className="space-y-2 opacity-60">
            {resolved.slice(0, 10).map((op: any) => (
              <OperationRow
                key={op.id}
                operation={op}
                instances={instances ?? []}
                onApprove={() => {}}
                onDismiss={() => {}}
                onAssign={() => {}}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OperationRow({
  operation,
  instances,
  onApprove,
  onDismiss,
  onAssign,
}: {
  operation: any;
  instances: any[];
  onApprove: () => void;
  onDismiss: () => void;
  onAssign: (instanceId: string) => void;
}) {
  const latestRun = operation.runs?.[0];
  const timeAgo = formatTimeAgo(operation.createdAt);
  const assignedAgent = instances.find((i: any) => i.id === operation.instanceId);

  return (
    <div className="rounded-lg bg-surface-1 border border-border hover:border-accent/30 hover:bg-surface-2 transition-all">
      <Link
        to={`/operations/${operation.id}`}
        className="flex items-center gap-4 px-4 py-3"
      >
        {/* Routing status indicator */}
        <RoutingDot status={operation.routingStatus} />

        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[operation.priority] ?? PRIORITY_COLORS.P2}`}>
          {operation.priority}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-text-primary truncate">
              {operation.title}
            </p>
            {operation.intent && operation.intent !== 'custom' && (
              <IntentBadge intent={operation.intent} />
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {operation.summary && (
              <p className="text-[11px] text-text-tertiary truncate">{operation.summary}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Agent assignment */}
          {assignedAgent ? (
            <span className="text-[10px] text-accent bg-accent/10 px-2 py-0.5 rounded font-medium">
              {assignedAgent.name}
            </span>
          ) : (
            <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
              Unassigned
            </span>
          )}

          {latestRun && (
            <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
              {latestRun.status}
            </span>
          )}
          <span className="text-[10px] text-text-muted bg-surface-3 px-2 py-0.5 rounded">
            {STATUS_LABELS[operation.status] ?? operation.status}
          </span>
          <span className="text-[10px] text-text-tertiary tabular-nums">{timeAgo}</span>
        </div>
      </Link>

      {/* Inline routing approval */}
      {operation.routingStatus === 'pending' && operation.instanceId && (
        <div className="px-4 py-2 border-t border-border bg-amber-500/5 flex items-center gap-3">
          <span className="text-[10px] text-amber-400 flex-1">
            Suggested: <strong>{assignedAgent?.name ?? 'Agent'}</strong>
            {operation.routingConfidence != null && ` (${Math.round(operation.routingConfidence * 100)}% confidence)`}
            {operation.routingReason && ` — ${operation.routingReason}`}
          </span>
          <Button size="xs" onClick={(e) => { e.preventDefault(); onApprove(); }}>
            Approve
          </Button>
          <Button size="xs" variant="secondary" onClick={(e) => { e.preventDefault(); onDismiss(); }}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Unassigned — assign manually */}
      {operation.routingStatus === 'pending' && !operation.instanceId && instances.length > 0 && (
        <div className="px-4 py-2 border-t border-border bg-surface-2 flex items-center gap-3">
          <span className="text-[10px] text-text-tertiary flex-1">
            {operation.routingReason || 'No agent match. Assign manually:'}
          </span>
          {instances.filter((i: any) => i.status === 'running').slice(0, 3).map((inst: any) => (
            <Button
              key={inst.id}
              size="xs"
              variant="secondary"
              onClick={(e) => { e.preventDefault(); onAssign(inst.id); }}
            >
              {inst.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function RoutingDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    auto_routed: 'bg-emerald-400',
    approved: 'bg-emerald-400',
    manual: 'bg-emerald-400',
    pending: 'bg-amber-400',
  };
  return (
    <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] ?? 'bg-zinc-500'}`} />
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
