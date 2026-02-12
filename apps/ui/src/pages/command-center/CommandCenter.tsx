/**
 * Dashboard — Mission Control Board
 *
 * Mission Cards per instance showing:
 *   - Status, goal, current step
 *   - Pipeline bar (Planning → Executing → Approval → Done)
 *   - Key metrics: actions, pending, trust score, cost
 *   - Sub-agents (if any)
 *   - Blocked action inline approval
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getStats,
  getInstances,
  getApprovals,
  getMission,
  approveApproval,
  type Instance,
  type MissionData,
} from '../../api/client.ts';
import { StatusDot } from '../../components/common/StatusDot.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Badge, riskTierVariant } from '../../components/common/Badge.tsx';
import { humanReadableAction } from '../../components/common/ActionSummary.tsx';
import { useToast } from '../../components/common/Toast.tsx';

// ── Trust Score Badge ────────────────────────────────────────────────────────

function TrustBadge({ score, trend }: { score: number; trend?: string }) {
  const color = score > 70 ? 'text-emerald-400 bg-emerald-500/10' : score > 40 ? 'text-amber-400 bg-amber-500/10' : 'text-red-400 bg-red-500/10';
  const arrow = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${color}`}>
      {score} {arrow && <span className="text-[9px]">{arrow}</span>}
    </span>
  );
}

// ── Pipeline Bar ─────────────────────────────────────────────────────────────

function PipelineBar({ pipeline, blockedActions }: { pipeline: MissionData['pipeline']; blockedActions: number }) {
  const stages = [
    { key: 'PLANNING', label: 'Planning', count: pipeline.PLANNING, color: 'bg-blue-500' },
    { key: 'EXECUTING', label: 'Executing', count: pipeline.EXECUTING, color: 'bg-indigo-500' },
    { key: 'AWAITING_APPROVAL', label: 'Approval', count: pipeline.AWAITING_APPROVAL, color: blockedActions > 0 ? 'bg-amber-500 animate-pulse' : 'bg-amber-500' },
    { key: 'COMPLETED', label: 'Done', count: pipeline.COMPLETED, color: 'bg-emerald-500' },
  ];

  const total = stages.reduce((a, s) => a + s.count, 0) || 1;

  return (
    <div>
      {/* Bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-surface-3 gap-px">
        {stages.map((s) => (
          s.count > 0 && (
            <div
              key={s.key}
              className={`${s.color} transition-all duration-500`}
              style={{ width: `${(s.count / total) * 100}%` }}
            />
          )
        ))}
      </div>
      {/* Labels */}
      <div className="flex justify-between mt-1.5">
        {stages.map((s) => (
          <div key={s.key} className="text-center flex-1">
            <span className={`text-[10px] font-medium ${s.count > 0 ? 'text-text-primary' : 'text-text-muted opacity-40'}`}>
              {s.count > 0 ? s.count : '·'}
            </span>
            <p className="text-[8px] text-text-muted">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Mission Card ─────────────────────────────────────────────────────────────

function MissionCard({
  instance,
  mission,
  pendingApproval,
  onApprove,
  approving,
}: {
  instance: Instance;
  mission: MissionData | undefined;
  pendingApproval: any;
  onApprove: (id: string) => void;
  approving: boolean;
}) {
  const isBlocked = (mission?.blockedActions ?? 0) > 0;
  const statusLabel = isBlocked ? 'blocked' : instance.status === 'running' ? 'active' : instance.status;

  return (
    <div
      className={
        'rounded-xl border p-5 transition-all ' +
        (isBlocked
          ? 'border-amber-500/25 bg-surface-1 shadow-[0_0_20px_-5px_rgba(245,158,11,0.1)]'
          : 'border-border bg-surface-1 hover:border-border-strong')
      }
    >
      {/* Header: name + status */}
      <div className="flex items-center gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">{instance.name}</h3>
            <StatusDot status={statusLabel} showLabel />
          </div>
          {mission?.currentStep && mission.currentStep !== 'Idle' && (
            <p className="text-xs text-text-secondary mt-0.5 truncate">
              {mission.currentStep}
            </p>
          )}
        </div>

        {/* Trust score */}
        {mission && <TrustBadge score={mission.trustScore} trend={mission.trustTrend} />}
      </div>

      {/* Pipeline bar */}
      {mission && (
        <div className="mb-4">
          <PipelineBar pipeline={mission.pipeline} blockedActions={mission.blockedActions} />
        </div>
      )}

      {/* Key metrics row */}
      <div className="flex items-center gap-4 text-[11px] mb-3">
        <div>
          <span className="text-text-muted">Actions: </span>
          <span className="text-text-primary font-medium">{mission?.progress.total ?? 0}</span>
        </div>
        <div>
          <span className="text-text-muted">Pending: </span>
          <span className={`font-medium ${(mission?.progress.pending ?? 0) > 0 ? 'text-amber-400' : 'text-text-primary'}`}>
            {mission?.progress.pending ?? 0}
          </span>
        </div>
        <div>
          <span className="text-text-muted">Denied: </span>
          <span className={`font-medium ${(mission?.progress.denied ?? 0) > 0 ? 'text-red-400' : 'text-text-primary'}`}>
            {mission?.progress.denied ?? 0}
          </span>
        </div>
        {mission?.estimatedCost !== undefined && mission.estimatedCost > 0 && (
          <div className="ml-auto">
            <span className="text-text-muted">Cost today: </span>
            <span className="text-text-primary font-mono">${mission.estimatedCost.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Sub-agents */}
      {mission?.subAgents && mission.subAgents.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {mission.subAgents.map((sa) => (
            <span
              key={sa.sessionId}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] ${
                sa.status === 'awaiting_approval'
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'bg-surface-3 text-text-muted'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${sa.status === 'awaiting_approval' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              {sa.lastAction.length > 40 ? sa.lastAction.slice(0, 40) + '...' : sa.lastAction}
            </span>
          ))}
        </div>
      )}

      {/* Model + runtime info */}
      <div className="flex items-center gap-3 text-[10px] text-text-muted">
        <span className="font-mono">{instance.agentRuntime}</span>
        <span>·</span>
        <span className="font-mono">{instance.model?.split('-').slice(0, 2).join('-') ?? 'unknown'}</span>
        {instance.telegramBot && <><span>·</span><span>TG: {instance.telegramBot}</span></>}
        {instance.githubPat && <><span>·</span><span>GitHub ✓</span></>}
      </div>

      {/* Blocked action — inline approve */}
      {pendingApproval && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={riskTierVariant(pendingApproval.toolCall?.riskTier ?? 'WRITE')} className="text-[9px]">
                {pendingApproval.toolCall?.riskTier}
              </Badge>
              <span className="text-[10px] text-text-muted">{pendingApproval.toolCall?.toolName}</span>
            </div>
            <p className="text-xs text-amber-300 truncate">
              {pendingApproval.humanDescription || humanReadableAction(pendingApproval.toolCall?.toolName ?? '', pendingApproval.toolCall?.args)}
            </p>
          </div>
          <Button size="xs" onClick={() => onApprove(pendingApproval.id)} disabled={approving}>
            Approve
          </Button>
          <Link to="/approvals">
            <Button size="xs" variant="ghost">Review</Button>
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Mission Card with Data Fetching ─────────────────────────────────────────
// Each card owns its own useQuery — safe because the component is keyed by inst.id

function MissionCardWithData({
  instance,
  pendingApproval,
  onApprove,
  approving,
}: {
  instance: Instance;
  pendingApproval: any;
  onApprove: (id: string) => void;
  approving: boolean;
}) {
  const { data: mission } = useQuery({
    queryKey: ['mission', instance.id],
    queryFn: () => getMission(instance.id),
    refetchInterval: 8_000,
    enabled: instance.status === 'running',
  });

  return (
    <MissionCard
      instance={instance}
      mission={mission}
      pendingApproval={pendingApproval}
      onApprove={onApprove}
      approving={approving}
    />
  );
}

// ── Main CommandCenter ───────────────────────────────────────────────────────

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

  const running = (instances ?? []).filter((i) => i.status === 'running');
  const stopped = (instances ?? []).filter((i) => i.status !== 'running');

  const qc = useQueryClient();
  const { toast } = useToast();
  const approveMut = useMutation({
    mutationFn: (id: string) => approveApproval(id, { approver: 'dashboard' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      toast('Action approved', 'success');
    },
  });

  const pending = approvals ?? [];
  const allInstances = instances ?? [];
  const isEmpty = !loadingInstances && allInstances.length === 0 && pending.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg">
      <div className="max-w-4xl mx-auto">

        {/* ── Header */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-text-primary">
            {isEmpty && !hasData
              ? 'Welcome to Wooblay'
              : running.length > 0
                ? `${running.length} Instance${running.length !== 1 ? 's' : ''} Running`
                : hasData ? 'Dashboard' : 'No Instances Running'}
          </h1>
          {hasData && (
            <p className="text-xs text-text-muted mt-1">
              {stats!.totalToolCalls} actions tracked · {stats!.totalReceipts} receipts · {stats!.pendingApprovals} pending
            </p>
          )}
        </div>

        {/* ── Pending Approvals Banner */}
        {pending.length > 0 && (
          <Link
            to="/approvals"
            className="block mb-6 p-4 rounded-xl bg-amber-500/8 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="h-3 w-3 rounded-full bg-amber-400 animate-breathe shrink-0" />
              <span className="text-sm text-amber-300 font-medium">
                {pending.length} action{pending.length !== 1 ? 's' : ''} waiting for your approval
              </span>
              <span className="text-xs text-amber-400/60 ml-auto">Review →</span>
            </div>
          </Link>
        )}

        {/* ── Empty State */}
        {isEmpty && !hasData && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="h-16 w-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center text-2xl mb-6 opacity-60">
              ◎
            </div>
            <h2 className="text-base font-semibold text-text-primary mb-2">
              Deploy your first agent
            </h2>
            <p className="text-sm text-text-secondary mb-6 max-w-md leading-relaxed">
              Deploy an OpenClaw instance to start supervising AI agent actions.
              All tool executions will be routed through Wooblay for approval.
            </p>
            <Link to="/instances">
              <Button>Deploy Instance</Button>
            </Link>
          </div>
        )}

        {/* ── No instances but has historical data */}
        {allInstances.length === 0 && hasData && pending.length === 0 && (
          <div className="mb-6 p-5 rounded-xl bg-surface-1 border border-border text-center">
            <p className="text-sm text-text-secondary mb-3">
              No instances currently deployed. Previous activity is preserved.
            </p>
            <Link to="/instances">
              <Button size="sm">Deploy New Instance</Button>
            </Link>
          </div>
        )}

        {/* ── Mission Cards (Running Instances) */}
        <div className="space-y-3">
          {running.map((inst) => (
            <MissionCardWithData
              key={inst.id}
              instance={inst}
              pendingApproval={pending[0]}
              onApprove={(id) => approveMut.mutate(id)}
              approving={approveMut.isPending}
            />
          ))}
        </div>

        {/* ── Stopped Instances */}
        {stopped.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] text-text-muted uppercase tracking-wider px-1 mb-1">Stopped</p>
            {stopped.map((inst) => (
              <div key={inst.id} className="rounded-xl border border-border bg-surface-0 p-4 opacity-50">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-text-secondary flex-1">{inst.name}</h3>
                  <StatusDot status={inst.status} showLabel />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
