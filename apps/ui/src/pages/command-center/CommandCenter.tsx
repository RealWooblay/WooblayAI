/**
 * Dashboard — Mission Control Board
 *
 * Shows what matters:
 * 1. Deployed instances (from Instances page)
 * 2. Pending approvals that need attention
 * 3. Quick stats
 *
 * If nothing is deployed: clean empty state pointing to Instances page.
 * If instances exist: cards per instance with status + any blocked actions.
 * Pending approvals always shown prominently if any exist.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getStats,
  getInstances,
  getApprovals,
  getActivity,
  approveApproval,
} from '../../api/client.ts';
import type { Instance, ActivityItem } from '../../api/client.ts';
import { StatusDot } from '../../components/common/StatusDot.tsx';
import { JourneyPipeline } from '../../components/common/JourneyPipeline.tsx';
import { Button } from '../../components/common/Button.tsx';
import { Badge, riskTierVariant } from '../../components/common/Badge.tsx';
import { humanReadableAction } from '../../components/common/ActionSummary.tsx';
import { useToast } from '../../components/common/Toast.tsx';
import type { JourneyStep } from '../../components/common/JourneyPipeline.tsx';

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
  const { data: activityResp } = useQuery({
    queryKey: ['activity'],
    queryFn: () => getActivity({ pageSize: 30 }),
    refetchInterval: 5_000,
  });

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
  const activity = activityResp?.data ?? [];
  const allInstances = instances ?? [];
  const running = allInstances.filter((i) => i.status === 'running');
  const stopped = allInstances.filter((i) => i.status !== 'running');

  const isEmpty = !loadingInstances && allInstances.length === 0 && pending.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg">
      <div className="max-w-4xl mx-auto">

        {/* ── Header ─────────────────────────────────────── */}
        <div className="mb-6">
          <h1 className="text-lg font-bold text-text-primary">
            {isEmpty && !hasData
              ? 'Welcome to Wooblay'
              : running.length > 0
                ? `${running.length} Instance${running.length !== 1 ? 's' : ''} Running`
                : hasData
                  ? 'Dashboard'
                  : 'No Instances Running'}
          </h1>
          {hasData && (
            <p className="text-xs text-text-muted mt-1">
              {stats!.totalToolCalls} actions tracked · {stats!.totalReceipts} receipts · {stats!.pendingApprovals} pending
            </p>
          )}
        </div>

        {/* ── Pending Approvals Banner ────────────────────── */}
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

        {/* ── Empty State ────────────────────────────────── */}
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

        {/* ── No instances but has historical data ────────── */}
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

        {/* ── Running Instance Cards ─────────────────────── */}
        <div className="space-y-3">
          {running.map((inst) => (
            <InstanceCard
              key={inst.id}
              instance={inst}
              pending={pending}
              activity={activity}
              onApprove={(id) => approveMut.mutate(id)}
              approving={approveMut.isPending}
            />
          ))}
        </div>

        {/* ── Stopped Instances ───────────────────────────── */}
        {stopped.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-[10px] text-text-muted uppercase tracking-wider px-1 mb-1">
              Stopped
            </p>
            {stopped.map((inst) => (
              <div
                key={inst.id}
                className="rounded-xl border border-border bg-surface-0 p-4 opacity-50"
              >
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-medium text-text-secondary flex-1">{inst.name}</h3>
                  <StatusDot status={inst.status} showLabel />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Recent Activity (if instances exist) ────────── */}
        {allInstances.length > 0 && activity.length > 0 && (
          <div className="mt-8">
            <h2 className="text-xs text-text-muted uppercase tracking-wider mb-3">Recent Activity</h2>
            <div className="space-y-1">
              {activity.slice(0, 8).map((a) => (
                <div key={a.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-1 transition-colors">
                  <Badge variant={riskTierVariant(a.riskTier)} className="text-[8px] w-20 justify-center shrink-0">
                    {a.riskTier}
                  </Badge>
                  <span className="text-xs text-text-primary font-mono truncate flex-1">
                    {a.humanDescription || a.toolName}
                  </span>
                  <span className="text-[10px] text-text-muted shrink-0">
                    {a.status === 'completed' ? '✓' : a.approval?.status === 'PENDING' ? '⏳' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Instance Card Component ─────────────────────────────────────────────── */

function InstanceCard({
  instance,
  pending,
  activity,
  onApprove,
  approving,
}: {
  instance: Instance;
  pending: NonNullable<ReturnType<typeof getApprovals> extends Promise<infer T> ? T : never>;
  activity: ActivityItem[];
  onApprove: (id: string) => void;
  approving: boolean;
}) {
  // Find first pending approval (could be smarter with instance-agent linking later)
  const blocked = pending[0] ?? null;

  // Build journey steps from recent activity
  const steps: JourneyStep[] = activity.slice(0, 15).map((a) => ({
    label: a.humanDescription || a.toolName,
    status: a.approval?.status === 'PENDING'
      ? 'blocked'
      : a.execution || a.status === 'completed'
        ? 'done'
        : 'active',
  }));

  const latestAction = activity[0]?.humanDescription || activity[0]?.toolName || null;

  return (
    <div
      className={
        'rounded-xl border p-5 transition-colors ' +
        (blocked
          ? 'border-amber-500/20 bg-surface-1'
          : 'border-border bg-surface-1 hover:border-border-strong')
      }
    >
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <h3 className="text-sm font-semibold text-text-primary flex-1">
          {instance.name}
        </h3>
        <StatusDot status={blocked ? 'blocked' : 'running'} showLabel />
      </div>

      {/* Meta */}
      <div className="flex items-center gap-3 text-xs text-text-muted mb-3">
        <span className="font-mono">{instance.model || 'openclaw'}</span>
        {instance.endpoint && <span>· {instance.endpoint}</span>}
      </div>

      {/* Current task */}
      {latestAction && (
        <p className="text-xs text-text-secondary mb-3">
          Latest: {latestAction}
        </p>
      )}

      {/* Journey progress */}
      {steps.length > 0 ? (
        <JourneyPipeline steps={steps} />
      ) : (
        <div className="flex items-center gap-3">
          <div className="flex-1 h-1.5 bg-surface-3 rounded-full" />
          <span className="text-xs text-text-muted">Waiting for activity</span>
        </div>
      )}

      {/* Blocked action — inline approve */}
      {blocked && (
        <div className="mt-3 flex items-center gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/10">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={riskTierVariant(blocked.toolCall?.riskTier ?? 'WRITE')} className="text-[9px]">
                {blocked.toolCall?.riskTier}
              </Badge>
              <span className="text-[10px] text-text-muted">
                {blocked.toolCall?.toolName}
              </span>
            </div>
            <code className="text-xs font-mono text-amber-300 truncate block">
              {humanReadableAction(blocked.toolCall?.toolName ?? '', blocked.toolCall?.args)}
            </code>
          </div>
          <Button
            size="xs"
            onClick={() => onApprove(blocked.id)}
            disabled={approving}
          >
            Approve
          </Button>
          <Link to="/approvals">
            <Button size="xs" variant="ghost">
              Review
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
