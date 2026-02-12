/**
 * Instance Detail Page — The deep-dive.
 *
 * Trust/contribution charts, role management, sub-agent network board (ASCII),
 * session list, cost breakdown, recent activity.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getInstance,
  getMission,
  getInstanceContributions,
  getInstanceCost,
  updateInstance,
  getActivity,
  getFlags,
  type MissionData,
  type ContributionResult,
  type Instance,
} from '../../api/client.ts';
import { Tooltip } from '../../components/common/Tooltip.tsx';
import { Button } from '../../components/common/Button.tsx';

// ── Category Colors ──────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  code: 'bg-blue-500',
  git: 'bg-purple-500',
  packages: 'bg-pink-500',
  shell: 'bg-zinc-500',
  files: 'bg-cyan-500',
  network: 'bg-indigo-500',
  secrets: 'bg-red-500',
  infra: 'bg-orange-500',
  communication: 'bg-yellow-500',
  destructive: 'bg-red-600',
  data: 'bg-teal-500',
  other: 'bg-zinc-600',
};

const CATEGORY_TEXT: Record<string, string> = {
  code: 'text-blue-400',
  git: 'text-purple-400',
  packages: 'text-pink-400',
  shell: 'text-zinc-400',
  files: 'text-cyan-400',
  network: 'text-indigo-400',
  secrets: 'text-red-400',
  infra: 'text-orange-400',
  communication: 'text-yellow-400',
  destructive: 'text-red-400',
  data: 'text-teal-400',
  other: 'text-zinc-500',
};

// ── Sparkline Chart ──────────────────────────────────────────────────────────

function Sparkline({ data, color = 'bg-accent' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-px h-10">
      {data.map((v, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${color} opacity-70 hover:opacity-100 transition-opacity min-w-[3px]`}
          style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
        />
      ))}
    </div>
  );
}

// ── Category Breakdown Bar ───────────────────────────────────────────────────

function CategoryBar({ breakdown }: { breakdown: Record<string, number> }) {
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);

  return (
    <div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-3 gap-px">
        {sorted.map(([cat, count]) => (
          <Tooltip key={cat} content={`${cat}: ${count} (${Math.round((count / total) * 100)}%)`}>
            <div
              className={`${CATEGORY_COLORS[cat] ?? 'bg-zinc-600'} transition-all`}
              style={{ width: `${(count / total) * 100}%` }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {sorted.slice(0, 5).map(([cat, count]) => (
          <span key={cat} className="text-[10px] text-text-muted flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${CATEGORY_COLORS[cat] ?? 'bg-zinc-600'}`} />
            {cat} {Math.round((count / total) * 100)}%
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Agent State (ASCII style) ────────────────────────────────────────────────

function AgentStateDisplay({ mission, instance }: { mission?: MissionData; instance: Instance }) {
  if (instance.status !== 'running') {
    return (
      <div className="font-mono text-xs text-text-muted">
        <span className="text-zinc-600">_ </span>offline
      </div>
    );
  }
  if (!mission) return null;

  const blocked = mission.blockedActions > 0;
  const pending = mission.progress.pending > 0;
  const denied = mission.progress.denied > 2;
  const isIdle = mission.currentStep === 'Idle' || mission.currentStep === 'No activity yet';

  if (denied) {
    return (
      <div className="font-mono text-xs text-red-400">
        <span className="font-bold">✕</span> blocked — {mission.progress.denied} denied
      </div>
    );
  }
  if (blocked || pending) {
    return (
      <div className="font-mono text-xs text-amber-400 animate-pulse">
        ⏳ awaiting approval...
      </div>
    );
  }
  if (!isIdle) {
    return (
      <div className="font-mono text-xs text-emerald-400">
        <span className="animate-blink">▋</span> {mission.currentStep}
      </div>
    );
  }
  return (
    <div className="font-mono text-xs text-text-muted">
      <span className="animate-breathe inline-block">_</span> standing by
    </div>
  );
}

// ── Role Update Modal ────────────────────────────────────────────────────────

function RoleModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const qc = useQueryClient();
  const [roleText, setRoleText] = useState(instance.role ?? instance.inferredRole ?? '');

  const mutation = useMutation({
    mutationFn: (role: string) => updateInstance(instance.id, { configOverrides: {}, role } as any),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instance', instance.id] });
      void qc.invalidateQueries({ queryKey: ['mission', instance.id] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-surface-1 border border-border rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-text-primary mb-1">Update Agent Role</h3>
        <p className="text-[11px] text-text-muted mb-4">
          This will be sent to the agent and used by the AI supervisor for threat assessment.
        </p>
        <input
          type="text"
          value={roleText}
          onChange={e => setRoleText(e.target.value)}
          placeholder="e.g. Frontend developer building React dashboard"
          className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent mb-4"
        />
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => mutation.mutate(roleText)}
            disabled={mutation.isPending || !roleText.trim()}
          >
            {mutation.isPending ? 'Updating...' : 'Update Role'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Network Board (ASCII aesthetic) ──────────────────────────────────────────

function NetworkBoard({ mission, instances }: { mission?: MissionData; instances: Instance[] }) {
  if (!mission) return null;

  const subAgents = mission.subAgents ?? [];
  const otherInstances = instances.filter(i => i.id !== mission.instanceId && i.status === 'running');

  return (
    <div className="bg-surface-0 border border-border rounded-xl p-5">
      <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-4">Agent Network</h3>
      <div className="font-mono text-[11px] space-y-1">
        {/* Main agent */}
        <div className="border border-border rounded-lg p-3 inline-block min-w-[280px]">
          <div className="text-text-primary font-medium">{mission.instanceName}</div>
          <div className={`mt-1 ${mission.blockedActions > 0 ? 'text-amber-400' : mission.currentStep === 'Idle' ? 'text-text-muted' : 'text-emerald-400'}`}>
            {mission.blockedActions > 0 ? '⏳ awaiting approval...' : mission.currentStep === 'Idle' ? (
              <span><span className="animate-breathe inline-block">_</span> standing by</span>
            ) : (
              <span><span className="animate-blink">▋</span> {mission.currentStep.slice(0, 35)}</span>
            )}
          </div>
          <div className="text-text-muted mt-1">
            trust: {mission.trustScore} &nbsp; cost: ${mission.estimatedCost.toFixed(2)}
          </div>
        </div>

        {/* Sub-agents */}
        {subAgents.length > 0 && (
          <div className="pl-4 space-y-1">
            {subAgents.map((sa, i) => (
              <div key={sa.sessionId} className="flex items-start gap-2">
                <span className="text-text-muted shrink-0 mt-1">
                  {i === subAgents.length - 1 ? '└──' : '├──'}
                </span>
                <div className="border border-border/50 rounded-lg p-2 text-[10px]">
                  <span className="text-text-secondary">session:{sa.sessionId.slice(0, 8)}</span>
                  <span className="mx-2 text-text-muted">·</span>
                  <span className={sa.status === 'awaiting_approval' ? 'text-amber-400' : 'text-emerald-400'}>
                    {sa.lastAction.slice(0, 40)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Other instances */}
        {otherInstances.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/30">
            <div className="text-text-muted text-[10px] mb-2">other active agents</div>
            <div className="flex flex-wrap gap-2">
              {otherInstances.map(inst => (
                <Link
                  key={inst.id}
                  to={`/instances/${inst.id}`}
                  className="border border-border/50 rounded-lg px-3 py-1.5 text-[10px] text-text-muted hover:text-text-primary hover:border-border transition-colors"
                >
                  {inst.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {subAgents.length === 0 && otherInstances.length === 0 && (
          <div className="text-text-muted text-[10px] mt-2">No sub-agents or other instances detected.</div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [showRoleModal, setShowRoleModal] = useState(false);

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id],
    queryFn: () => getInstance(id!),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const { data: mission } = useQuery({
    queryKey: ['mission', id],
    queryFn: () => getMission(id!),
    enabled: !!id && instance?.status === 'running',
    refetchInterval: 8_000,
  });

  const { data: contributions } = useQuery({
    queryKey: ['contributions', id],
    queryFn: () => getInstanceContributions(id!),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const { data: cost } = useQuery({
    queryKey: ['cost', id],
    queryFn: () => getInstanceCost(id!),
    enabled: !!id,
    refetchInterval: 15_000,
  });

  const { data: allInstances } = useQuery({
    queryKey: ['instances'],
    queryFn: () => import('../../api/client.ts').then(m => m.getInstances()),
    refetchInterval: 15_000,
  });

  const { data: activity } = useQuery({
    queryKey: ['activity', 'instance', id],
    queryFn: () => getActivity({ page: 1, pageSize: 20 }),
    enabled: !!id,
    refetchInterval: 10_000,
  });

  const { data: flagsData } = useQuery({
    queryKey: ['flags', 'instance'],
    queryFn: () => getFlags({ dismissed: 'false', limit: '10' }),
    refetchInterval: 15_000,
  });

  if (isLoading || !instance) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-text-muted text-sm animate-pulse">Loading instance...</div>
      </div>
    );
  }

  const effectiveRole = mission?.role ?? instance.role ?? (instance as any).inferredRole ?? null;
  const roleOverridden = mission?.roleOverridden ?? !!instance.role;
  const byDay = contributions?.byDay ?? [];
  const dailyCounts = byDay.map(d => d.count);
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Back link */}
      <Link to="/" className="text-xs text-text-muted hover:text-text-primary transition-colors">
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-text-primary">{instance.name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
              instance.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' :
              instance.status === 'stopped' ? 'bg-zinc-500/10 text-zinc-400' :
              'bg-amber-500/10 text-amber-400'
            }`}>
              {instance.status}
            </span>
          </div>

          {/* Role */}
          <button
            onClick={() => setShowRoleModal(true)}
            className="text-sm text-text-secondary hover:text-text-primary transition-colors group flex items-center gap-2"
          >
            {effectiveRole ? (
              <>
                <span>Role: {effectiveRole}</span>
                {roleOverridden && <span className="text-[9px] text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">overridden</span>}
                <span className="text-[10px] text-text-muted opacity-0 group-hover:opacity-100">edit</span>
              </>
            ) : instance.status === 'running' ? (
              <span className="text-text-muted italic">Observing agent behavior...</span>
            ) : (
              <span className="text-text-muted">Set agent role →</span>
            )}
          </button>

          {/* Agent state */}
          <div className="mt-2">
            <AgentStateDisplay mission={mission} instance={instance} />
          </div>
        </div>
      </div>

      {/* Anomaly Alerts */}
      {criticalFlags.length > 0 && (
        <div className="space-y-2">
          {criticalFlags.slice(0, 3).map(flag => (
            <div key={flag.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 flex items-start gap-3">
              <span className="text-[10px] font-bold text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded shrink-0 mt-0.5">
                {flag.severity}
              </span>
              <div className="min-w-0">
                <p className="text-xs text-red-300 font-medium">{flag.title}</p>
                <p className="text-[11px] text-red-400/70 mt-0.5 truncate">{flag.description.split('\n')[0]}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tooltip content="Computed from approval history and detected flags. 0=untrusted, 100=fully autonomous.">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Trust Score</div>
            <div className="flex items-center gap-2">
              <span className={`text-2xl font-bold tabular-nums ${
                (mission?.trustScore ?? 70) > 70 ? 'text-emerald-400' :
                (mission?.trustScore ?? 70) > 40 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {mission?.trustScore ?? 70}
              </span>
              {mission?.trustTrend === 'up' && <span className="text-emerald-400 text-sm">↑</span>}
              {mission?.trustTrend === 'down' && <span className="text-red-400 text-sm">↓</span>}
            </div>
            {/* Trust bar */}
            <div className="mt-2 h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  (mission?.trustScore ?? 70) > 70 ? 'bg-emerald-500' :
                  (mission?.trustScore ?? 70) > 40 ? 'bg-amber-500' : 'bg-red-500'
                }`}
                style={{ width: `${mission?.trustScore ?? 70}%` }}
              />
            </div>
          </div>
        </Tooltip>

        <Tooltip content="Estimated cost based on tool type heuristics. Actual LLM costs may vary.">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Cost</div>
            <div className="text-2xl font-bold text-text-primary font-mono tabular-nums">
              ${(cost?.costToday ?? mission?.estimatedCost ?? 0).toFixed(2)}
            </div>
            <div className="text-[10px] text-text-muted mt-1">
              This week: ${(cost?.costThisWeek ?? 0).toFixed(2)}
            </div>
          </div>
        </Tooltip>

        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Actions</div>
          <div className="text-2xl font-bold text-text-primary tabular-nums">
            {mission?.progress.total ?? cost?.actionCount ?? 0}
          </div>
          <div className="flex gap-3 text-[10px] mt-1">
            {(mission?.progress.pending ?? 0) > 0 && <span className="text-amber-400">{mission!.progress.pending} pending</span>}
            {(mission?.progress.denied ?? 0) > 0 && <span className="text-red-400">{mission!.progress.denied} denied</span>}
            {!(mission?.progress.pending ?? 0) && !(mission?.progress.denied ?? 0) && <span className="text-text-muted">all clear</span>}
          </div>
        </div>

        <Tooltip content="AI-assessed quality of agent work output">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Contribution</div>
            <div className="text-2xl font-bold text-text-primary tabular-nums">
              {contributions?.summary.totalActions ?? 0}
            </div>
            <div className="text-[10px] text-text-muted mt-1">
              {contributions?.summary.filesCreated ?? 0} files · {contributions?.summary.commandsExecuted ?? 0} cmds
            </div>
          </div>
        </Tooltip>
      </div>

      {/* Charts Row */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* Contributions per day */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-3">Activity — Last 7 Days</div>
          {dailyCounts.length > 0 ? (
            <Sparkline data={dailyCounts} color="bg-accent" />
          ) : (
            <div className="h-10 flex items-center text-[10px] text-text-muted">No data yet</div>
          )}
          {byDay.length > 0 && (
            <div className="flex justify-between mt-1 text-[9px] text-text-muted">
              <span>{byDay[0]?.date.slice(5)}</span>
              <span>{byDay[byDay.length - 1]?.date.slice(5)}</span>
            </div>
          )}
        </div>

        {/* Category breakdown */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider mb-3">Action Categories</div>
          {mission?.categoryBreakdown && Object.keys(mission.categoryBreakdown).length > 0 ? (
            <CategoryBar breakdown={mission.categoryBreakdown} />
          ) : (
            <div className="h-10 flex items-center text-[10px] text-text-muted">No category data yet</div>
          )}
        </div>
      </div>

      {/* Network Board */}
      <NetworkBoard mission={mission} instances={allInstances ?? []} />

      {/* Recent Activity */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider">Recent Activity</h3>
          <Link to="/activity" className="text-[10px] text-accent hover:underline">View all →</Link>
        </div>
        {!activity?.data.length ? (
          <div className="p-6 text-center text-text-muted text-xs">
            No agent actions recorded yet. Actions will appear here once your agent starts executing tasks.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activity.data.slice(0, 10).map(item => (
              <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-surface-2/50 transition-colors">
                <span className="text-[10px] text-text-muted w-[70px] shrink-0 font-mono">
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_TEXT[(item as any).category ?? 'other'] ?? 'text-zinc-400'} bg-surface-3`}>
                  {(item as any).category ?? item.riskTier}
                </span>
                <span className="text-text-primary truncate flex-1">{item.humanDescription}</span>
                <span className={`text-[10px] font-medium ${
                  item.status === 'denied' ? 'text-red-400' :
                  item.status === 'pending' ? 'text-amber-400' :
                  'text-emerald-400'
                }`}>
                  {item.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sessions */}
      {mission?.subAgents && mission.subAgents.length > 0 && (
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <h3 className="text-xs font-medium text-text-muted uppercase tracking-wider mb-3">Sessions</h3>
          <div className="space-y-2">
            {mission.subAgents.map(sa => (
              <div key={sa.sessionId} className="flex items-center gap-3 text-xs">
                <span className={`w-2 h-2 rounded-full ${sa.status === 'awaiting_approval' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                <span className="font-mono text-text-muted">{sa.sessionId.slice(0, 12)}</span>
                <span className="text-text-secondary truncate flex-1">{sa.lastAction}</span>
                <span className="text-[10px] text-text-muted">{sa.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Role Modal */}
      {showRoleModal && <RoleModal instance={instance} onClose={() => setShowRoleModal(false)} />}
    </div>
  );
}
