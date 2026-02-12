/**
 * Dashboard — Simple Overview
 *
 * Compact cards per instance showing state, role, trust, cost, last action.
 * Click anywhere to navigate to /instances/:id for the deep-dive.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  getStats,
  getInstances,
  getApprovals,
  getMission,
  approveApproval,
  type Instance,
  type MissionData,
} from '../../api/client.ts';
import { Button } from '../../components/common/Button.tsx';
import { Tooltip } from '../../components/common/Tooltip.tsx';
import { useToast } from '../../components/common/Toast.tsx';

// ── Agent State ──────────────────────────────────────────────────────────────

function AgentState({ mission, instance }: { mission: MissionData | undefined; instance: Instance }) {
  if (instance.status !== 'running') {
    return (
      <span className="flex items-center gap-2 text-xs text-text-muted">
        <span className="w-2 h-2 rounded-full bg-zinc-600" />
        Stopped
      </span>
    );
  }

  if (!mission) {
    return (
      <span className="flex items-center gap-2 text-xs text-text-muted">
        <span className="w-2 h-2 rounded-full bg-zinc-500 animate-pulse" />
        Loading...
      </span>
    );
  }

  const blocked = mission.blockedActions > 0;
  const pending = mission.progress.pending > 0;
  const denied = mission.progress.denied > 2;
  const hasActivity = mission.progress.total > 0;
  const isIdle = mission.currentStep === 'Idle' || mission.currentStep === 'No activity yet';

  if (denied) {
    return (
      <span className="flex items-center gap-2 text-xs text-red-400">
        <span className="w-2 h-2 rounded-full bg-red-400" />
        <span className="font-mono">✕</span> {mission.progress.denied} denied
      </span>
    );
  }
  if (blocked || pending) {
    return (
      <span className="flex items-center gap-2 text-xs text-amber-400">
        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
        Waiting for you
      </span>
    );
  }
  if (hasActivity && !isIdle) {
    return (
      <span className="flex items-center gap-2 text-xs text-emerald-400">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="font-mono animate-blink">▋</span>
        <span className="truncate max-w-[200px]">{mission.currentStep}</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs text-text-muted">
      <span className="w-2 h-2 rounded-full bg-zinc-500 animate-breathe" />
      Standing by
    </span>
  );
}

// ── Instance Overview Card ───────────────────────────────────────────────────

function InstanceCardWithData({ instance }: { instance: Instance }) {
  const navigate = useNavigate();
  const isRunning = instance.status === 'running';

  const { data: mission } = useQuery({
    queryKey: ['mission', instance.id],
    queryFn: () => getMission(instance.id),
    refetchInterval: 8_000,
    enabled: isRunning,
  });

  const hasAnomaly = false; // TODO: wire up flags for this instance

  const effectiveRole = mission?.role ?? instance.role ?? instance.inferredRole ?? null;

  return (
    <button
      onClick={() => navigate(`/instances/${instance.id}`)}
      className={
        'w-full text-left rounded-xl border p-5 transition-all hover:border-accent/40 cursor-pointer ' +
        (mission?.blockedActions
          ? 'border-amber-500/25 bg-surface-1 shadow-[0_0_15px_-5px_rgba(245,158,11,0.08)]'
          : 'border-border bg-surface-1 hover:bg-surface-1/80')
      }
    >
      {/* Row 1: Name + Role + State */}
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-text-primary truncate">{instance.name}</h3>
            {hasAnomaly && (
              <Tooltip content="Anomaly detected — click for details">
                <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
              </Tooltip>
            )}
          </div>
          {effectiveRole ? (
            <p className="text-[11px] text-text-secondary truncate">{effectiveRole}</p>
          ) : isRunning ? (
            <p className="text-[11px] text-text-muted italic">Observing...</p>
          ) : null}
        </div>
        <AgentState mission={mission} instance={instance} />
      </div>

      {/* Row 2: Metrics */}
      {mission && (
        <div className="flex items-center gap-5 text-[11px] mb-2.5">
          <Tooltip content="Trust score: 0=untrusted, 100=fully autonomous">
            <div className="flex items-center gap-1.5">
              <span className="text-text-muted">Trust</span>
              <span className={`font-bold tabular-nums ${mission.trustScore > 70 ? 'text-emerald-400' : mission.trustScore > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {mission.trustScore}
              </span>
              {mission.trustTrend === 'up' && <span className="text-emerald-400 text-[9px]">↑</span>}
              {mission.trustTrend === 'down' && <span className="text-red-400 text-[9px]">↓</span>}
            </div>
          </Tooltip>

          <Tooltip content="Estimated cost based on tool type heuristics">
            <div className="flex items-center gap-1.5">
              <span className="text-text-muted">Cost</span>
              <span className="text-text-primary font-mono font-medium">${mission.estimatedCost.toFixed(2)}</span>
            </div>
          </Tooltip>

          <div className="flex items-center gap-1.5">
            <span className="text-text-muted">Actions</span>
            <span className="text-text-primary font-medium tabular-nums">{mission.progress.total}</span>
            {mission.progress.pending > 0 && (
              <span className="text-amber-400 font-medium tabular-nums">/ {mission.progress.pending} pending</span>
            )}
          </div>
        </div>
      )}

      {/* Row 3: Last action */}
      {mission && mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet' && (
        <p className="text-[10px] text-text-muted truncate">
          Last: {mission.currentStep}
        </p>
      )}
    </button>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export function CommandCenter() {
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 5_000,
  });
  const { data: instances, isLoading: loadingInstances } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    refetchInterval: 5_000,
  });
  const { data: approvals } = useQuery({
    queryKey: ['approvals', 'pending'],
    queryFn: getApprovals,
    refetchInterval: 5_000,
  });

  const qc = useQueryClient();
  const { toast } = useToast();
  const approveMut = useMutation({
    mutationFn: (id: string) => approveApproval(id, { approver: 'dashboard' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      toast('Action approved', 'success');
    },
  });

  const allInstances = instances ?? [];
  const running = allInstances.filter(i => i.status === 'running');
  const stopped = allInstances.filter(i => i.status !== 'running');
  const pending = approvals ?? [];
  const isEmpty = !loadingInstances && allInstances.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-text-primary">
            {isEmpty && !hasData
              ? 'Welcome to Wooblay'
              : running.length > 0
                ? `${running.length} Instance${running.length !== 1 ? 's' : ''} Running`
                : 'Dashboard'}
          </h1>
          {hasData && (
            <p className="text-xs text-text-muted mt-1">
              {stats!.totalToolCalls} actions tracked · {stats!.pendingApprovals} pending
            </p>
          )}
        </div>

        {/* Pending Approvals Banner */}
        {pending.length > 0 && (
          <Link
            to="/approvals"
            className="block mb-6 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-amber-400 animate-breathe shrink-0" />
              <span className="text-sm text-amber-300 font-medium">
                {pending.length} action{pending.length !== 1 ? 's' : ''} waiting for approval
              </span>
              <span className="text-xs text-amber-400/60 ml-auto">Review →</span>
            </div>
          </Link>
        )}

        {/* Empty State */}
        {isEmpty && !hasData && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center text-2xl mb-6 opacity-60">
              ◎
            </div>
            <h2 className="text-base font-semibold text-text-primary mb-2">
              No instances running
            </h2>
            <p className="text-sm text-text-secondary mb-6 max-w-md leading-relaxed">
              Create an instance to get started. All agent actions will be routed through Wooblay for supervision.
            </p>
            <Link to="/instances">
              <Button>Create Instance</Button>
            </Link>
          </div>
        )}

        {/* Instance Cards Grid */}
        {allInstances.length > 0 && (
          <div className={`grid gap-3 ${allInstances.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {running.map(inst => (
              <InstanceCardWithData key={inst.id} instance={inst} />
            ))}
          </div>
        )}

        {/* Stopped Instances */}
        {stopped.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] text-text-muted uppercase tracking-wider px-1 mb-1">Stopped</p>
            {stopped.map(inst => (
              <Link
                key={inst.id}
                to={`/instances/${inst.id}`}
                className="block rounded-xl border border-border bg-surface-0 p-4 opacity-50 hover:opacity-70 transition-opacity"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-text-secondary flex-1">{inst.name}</h3>
                  <span className="flex items-center gap-1.5 text-xs text-text-muted">
                    <span className="w-2 h-2 rounded-full bg-zinc-600" />
                    {inst.status}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
