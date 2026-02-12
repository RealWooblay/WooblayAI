/**
 * Instance Detail — Deep dive into a single agent.
 *
 * Contribution tracking hero. Alive character with weather.
 * Pie chart for categories. Role management. Network board.
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getInstance,
  getInstances,
  getMission,
  getInstanceContributions,
  getInstanceCost,
  updateInstance,
  getActivity,
  getFlags,
  dismissFlag,
  type MissionData,
  type Instance,
} from '../../api/client.ts';
import { Tooltip } from '../../components/common/Tooltip.tsx';
import { Button } from '../../components/common/Button.tsx';

// ── Colors ───────────────────────────────────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
  code: '#3b82f6', git: '#a855f7', packages: '#ec4899',
  shell: '#71717a', files: '#06b6d4', network: '#6366f1',
  secrets: '#ef4444', infra: '#f97316', destructive: '#dc2626',
  data: '#14b8a6', communication: '#eab308', other: '#52525b',
};
const CAT_LABEL: Record<string, string> = {
  code: 'Code', git: 'Git', packages: 'Packages', shell: 'Shell',
  files: 'Files', network: 'Network', secrets: 'Secrets', infra: 'Infra',
  destructive: 'Destructive', data: 'Data', communication: 'Comms', other: 'Other',
};

// ── SVG Pie Chart ─────────────────────────────────────────────────────────────

function PieChart({ breakdown }: { breakdown: Record<string, number> }) {
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0) || 1;
  const sorted = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return <p className="text-xs text-text-tertiary font-mono">no data yet</p>;

  // Build pie segments using stroke-dasharray
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-4">
      <svg width="100" height="100" viewBox="0 0 100 100" className="shrink-0">
        {sorted.map(([cat, count]) => {
          const pct = count / total;
          const dashLength = pct * circumference;
          const dashOffset = -offset * circumference;
          offset += pct;
          return (
            <circle
              key={cat}
              cx="50" cy="50" r={radius}
              fill="none"
              stroke={CAT_COLOR[cat] ?? '#52525b'}
              strokeWidth="16"
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset}
              style={{ transition: 'all 0.5s ease' }}
            />
          );
        })}
        {/* Center text */}
        <text x="50" y="47" textAnchor="middle" className="fill-text-primary text-[14px] font-bold font-mono">{total}</text>
        <text x="50" y="58" textAnchor="middle" className="fill-text-tertiary text-[7px] font-mono">actions</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {sorted.map(([cat, count]) => (
          <span key={cat} className="text-[10px] text-text-secondary flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CAT_COLOR[cat] ?? '#52525b' }} />
            {CAT_LABEL[cat] ?? cat} <span className="text-text-tertiary tabular-nums">{Math.round((count / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Sparkline with Y-axis ────────────────────────────────────────────────────

function Sparkline({ data, color = 'bg-accent' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex items-end gap-1">
      {/* Y-axis labels */}
      <div className="flex flex-col justify-between h-12 mr-1 text-[8px] text-text-tertiary font-mono tabular-nums shrink-0 w-5 text-right">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      {/* Bars */}
      <div className="flex items-end gap-[2px] h-12 flex-1">
        {data.map((v, i) => (
          <Tooltip key={i} content={`${v} actions`}>
            <div
              className={`flex-1 rounded-sm ${color} opacity-60 hover:opacity-100 transition-opacity min-w-[4px]`}
              style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

// ── Alive Agent Character ─────────────────────────────────────────────────────

function AgentCharacter({ mission, instance }: { mission?: MissionData; instance: Instance }) {
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const schedule = () => {
      const wait = 2000 + Math.random() * 3000;
      const timeout = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 150);
        schedule();
      }, wait);
      return timeout;
    };
    const t = schedule();
    return () => clearTimeout(t);
  }, []);

  if (instance.status !== 'running') {
    return (
      <div className="font-mono text-center" style={{ animation: 'breathe 6s ease-in-out infinite' }}>
        <div className="text-zinc-600 text-xl">( -_- ) zzz</div>
        <div className="text-[10px] text-zinc-600 mt-1">offline</div>
      </div>
    );
  }
  if (!mission) {
    return (
      <div className="font-mono text-center animate-pulse">
        <div className="text-zinc-500 text-xl">( . . )</div>
        <div className="text-[10px] text-zinc-500 mt-1">connecting</div>
      </div>
    );
  }

  const eye = blink ? '-' : 'o';
  const eyeW = blink ? '-' : '•';
  const hasDenied = mission.progress.denied > 2;
  const hasPending = mission.blockedActions > 0;
  const isWorking = mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';

  if (hasDenied) return (
    <div className="font-mono text-center">
      <div className="text-red-400 text-xl" style={{ animation: 'breathe 1.5s ease-in-out infinite' }}>( x_x )</div>
      <div className="text-[10px] text-red-400 mt-1">{mission.progress.denied} denied</div>
    </div>
  );
  if (hasPending) return (
    <div className="font-mono text-center">
      <div className="text-amber-400 text-xl animate-breathe">( {blink ? '-' : '.'}_. )</div>
      <div className="text-[10px] text-amber-400 mt-1">needs your input</div>
    </div>
  );
  if (isWorking) return (
    <div className="font-mono text-center" style={{ animation: 'breathe 2s ease-in-out infinite' }}>
      <div className="text-emerald-400 text-xl">( {eyeW}_{eyeW})&gt;</div>
      <div className="text-[10px] text-emerald-400 mt-1 truncate max-w-[180px]">{mission.currentStep}</div>
    </div>
  );
  return (
    <div className="font-mono text-center" style={{ animation: 'breathe 4s ease-in-out infinite' }}>
      <div className="text-text-secondary text-xl">( {eye}_{eye} )</div>
      <div className="text-[10px] text-text-tertiary mt-1">standing by <span className="animate-blink">_</span></div>
    </div>
  );
}

// ── Role Modal ───────────────────────────────────────────────────────────────

function RoleModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const qc = useQueryClient();
  const [roleText, setRoleText] = useState(instance.role ?? (instance as any).inferredRole ?? '');
  const mutation = useMutation({
    mutationFn: (role: string) => updateInstance(instance.id, { role } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance', instance.id] });
      qc.invalidateQueries({ queryKey: ['mission', instance.id] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-surface-1 border border-border rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-text-primary mb-1 font-mono">Update Agent Role</h3>
        <p className="text-[10px] text-text-secondary mb-4">
          Tell the AI supervisor what this agent should be doing. Actions outside this role get flagged.
        </p>
        <input type="text" value={roleText} onChange={e => setRoleText(e.target.value)}
          placeholder="e.g. Frontend developer building React dashboard"
          className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent mb-4 font-mono" />
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => mutation.mutate(roleText)} disabled={mutation.isPending || !roleText.trim()}>
            {mutation.isPending ? 'Saving...' : 'Update'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Network Board ────────────────────────────────────────────────────────────

function NetworkBoard({ mission, instances }: { mission?: MissionData; instances: Instance[] }) {
  if (!mission) return null;
  const subAgents = mission.subAgents ?? [];
  const others = instances.filter(i => i.id !== mission.instanceId && i.status === 'running');

  return (
    <div className="bg-surface-0 border border-border rounded-xl p-5">
      <h3 className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-3">Agent Network</h3>
      <div className="font-mono text-[11px] space-y-1">
        <div className="border border-border rounded-lg p-3">
          <span className="text-text-primary font-medium">{mission.instanceName}</span>
          <span className="text-text-tertiary ml-2">trust:{mission.trustScore} cost:${mission.estimatedCost.toFixed(2)}</span>
        </div>
        {subAgents.length > 0 && (
          <div className="pl-4 space-y-1">
            {subAgents.map((sa, i) => (
              <div key={sa.sessionId} className="flex items-start gap-2">
                <span className="text-text-tertiary mt-1">{i === subAgents.length - 1 ? '└──' : '├──'}</span>
                <div className="border border-border/50 rounded-lg p-2 text-[10px]">
                  <span className="text-text-secondary">session:{sa.sessionId.slice(0, 8)}</span>
                  <span className={`ml-2 ${sa.status === 'awaiting_approval' ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {sa.lastAction.slice(0, 40)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/30">
            <div className="text-text-tertiary text-[10px] mb-2">other agents</div>
            <div className="flex flex-wrap gap-2">
              {others.map(inst => (
                <Link key={inst.id} to={`/instances/${inst.id}`}
                  className="border border-border/50 rounded-lg px-3 py-1.5 text-[10px] text-text-secondary hover:text-text-primary hover:border-accent/20 transition-colors">
                  {inst.name}
                </Link>
              ))}
            </div>
          </div>
        )}
        {subAgents.length === 0 && others.length === 0 && (
          <div className="text-text-tertiary text-[10px]">solo agent — no sub-agents detected</div>
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [showRoleModal, setShowRoleModal] = useState(false);

  const { data: instance, isLoading } = useQuery({
    queryKey: ['instance', id], queryFn: () => getInstance(id!),
    enabled: !!id, refetchInterval: 10_000,
  });
  const { data: mission } = useQuery({
    queryKey: ['mission', id], queryFn: () => getMission(id!),
    enabled: !!id && instance?.status === 'running', refetchInterval: 5_000,
  });
  const { data: contributions } = useQuery({
    queryKey: ['contributions', id], queryFn: () => getInstanceContributions(id!),
    enabled: !!id, refetchInterval: 20_000,
  });
  const { data: cost } = useQuery({
    queryKey: ['cost', id], queryFn: () => getInstanceCost(id!),
    enabled: !!id, refetchInterval: 15_000,
  });
  const { data: allInstances } = useQuery({
    queryKey: ['instances'], queryFn: getInstances, refetchInterval: 15_000,
  });
  const { data: activity } = useQuery({
    queryKey: ['activity', 'instance', id],
    queryFn: () => getActivity({ page: 1, pageSize: 15 }),
    enabled: !!id, refetchInterval: 10_000,
  });
  const { data: flagsData } = useQuery({
    queryKey: ['flags', 'instance', id],
    queryFn: () => getFlags({ dismissed: 'false', limit: '5' }),
    refetchInterval: 15_000,
  });
  const qc = useQueryClient();
  const dismissMutation = useMutation({
    mutationFn: dismissFlag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });

  if (isLoading || !instance) {
    return <div className="flex items-center justify-center h-64">
      <span className="text-text-secondary text-sm font-mono animate-pulse">loading...</span>
    </div>;
  }

  const effectiveRole = mission?.role ?? instance.role ?? (instance as any).inferredRole ?? null;
  const roleOverridden = mission?.roleOverridden ?? !!instance.role;
  const byDay = contributions?.byDay ?? [];
  const dailyCounts = byDay.map(d => d.count);
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const trust = mission?.trustScore ?? 0;
  const totalCost = cost?.costToday ?? mission?.estimatedCost ?? 0;
  const totalActions = contributions?.summary.totalActions ?? mission?.progress.total ?? 0;

  // ── Weather ──────────────────────────────────────────────────────────────
  const weather = useMemo(() => {
    if (!mission) return 'cloudy' as const;
    if (mission.progress.denied > 2 || criticalFlags.length > 0) return 'storm' as const;
    if (mission.blockedActions > 0 || mission.progress.pending > 0) return 'rain' as const;
    if (mission.trustScore > 60 && mission.progress.denied === 0) return 'sunny' as const;
    return 'cloudy' as const;
  }, [mission, criticalFlags.length]);

  const rainDrops = useMemo(() => {
    if (weather !== 'rain' && weather !== 'storm') return [];
    const count = weather === 'storm' ? 30 : 16;
    const chars = '·.:|/';
    return Array.from({ length: count }, (_, i) => ({
      left: (i / count) * 100 + (Math.random() * 4 - 2),
      char: chars[Math.floor(Math.random() * chars.length)],
      duration: 2.5 + Math.random() * 3,
      delay: Math.random() * -5,
      size: weather === 'storm' ? 12 : 10,
    }));
  }, [weather]);

  // ── Contribution Score ───────────────────────────────────────────────────
  const contributionScore = useMemo(() => {
    if (!contributions || contributions.summary.totalActions === 0) return 0;
    const s = contributions.summary;
    const efficiency = parseFloat(s.approvalEfficiency) || 0;
    const denialRate = parseFloat(s.denialRate) || 0;
    const outputScore = Math.min(100, (s.filesCreated * 5 + s.filesEdited * 3 + s.commandsExecuted * 2 + s.linesWritten * 0.1));
    return Math.round(Math.min(100, (efficiency * 0.3 + (100 - denialRate) * 0.2 + outputScore * 0.5)));
  }, [contributions]);

  return (
    <div className="relative">
      {/* Weather Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        {weather === 'sunny' && (
          <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.02] via-transparent to-transparent" />
        )}
        {weather === 'rain' && (
          <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.03] via-transparent to-transparent" />
        )}
        {weather === 'storm' && (
          <div className="absolute inset-0 bg-gradient-to-b from-red-500/[0.04] via-transparent to-transparent animate-pulse" style={{ animationDuration: '4s' }} />
        )}
        {rainDrops.map((d, i) => (
          <span
            key={i}
            className={`absolute font-mono ${weather === 'storm' ? 'text-red-500/20' : 'text-blue-500/15'}`}
            style={{
              left: `${d.left}%`,
              top: '-20px',
              fontSize: d.size,
              animation: `rain-fall ${d.duration}s linear ${d.delay}s infinite`,
            }}
          >
            {d.char}
          </span>
        ))}
      </div>

      <div className="max-w-5xl mx-auto space-y-5 relative z-10">
      <Link to="/" className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors font-mono">← dashboard</Link>

      {/* ── Header with Character ─────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <div className="flex items-start gap-6">
          <AgentCharacter mission={mission} instance={instance} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-text-primary font-mono">{instance.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium font-mono ${
                instance.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' :
                'bg-zinc-500/10 text-zinc-500'
              }`}>{instance.status}</span>
            </div>
            <button onClick={() => setShowRoleModal(true)}
              className="text-xs text-text-secondary hover:text-text-primary transition-colors group flex items-center gap-2 font-mono">
              {effectiveRole ? (
                <>role: {effectiveRole} {roleOverridden && <span className="text-[8px] text-text-tertiary bg-surface-3 px-1 rounded">set by you</span>}</>
              ) : instance.status === 'running' ? (
                <span className="text-text-tertiary italic">AI is observing to determine role...</span>
              ) : (
                <span className="text-text-tertiary">set role →</span>
              )}
              <span className="text-[9px] text-text-tertiary opacity-0 group-hover:opacity-100">edit</span>
            </button>
          </div>
        </div>
      </div>

      {/* ── Anomaly Alerts — per-agent, with smart CTAs ─────────────────── */}
      {criticalFlags.length > 0 && (
        <div className="space-y-1.5">
          {criticalFlags.slice(0, 3).map(flag => {
            // Smart CTA based on flag category
            const cta = flag.category === 'sensitive_access' || flag.category === 'privilege_escalation'
              ? { label: 'Update policies', to: '/policies' }
              : flag.category === 'evasion_pattern'
              ? { label: 'Review approvals', to: '/approvals' }
              : { label: 'View activity', to: '/activity' };
            return (
              <div key={flag.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
                <div className="flex items-start gap-3">
                  <span className="font-mono text-red-400 text-[10px] font-bold shrink-0 mt-0.5">[{flag.severity}]</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-red-300 font-medium">{flag.title}</p>
                    <p className="text-[10px] text-red-400/70 mt-0.5 truncate">{flag.description.split('\n')[0]}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <Link to={cta.to} className="text-[10px] text-red-300 font-medium hover:text-red-200 font-mono">{cta.label} →</Link>
                      <button
                        onClick={() => dismissMutation.mutate(flag.id)}
                        className="text-[10px] text-red-400/30 hover:text-red-400/70 font-mono"
                      >dismiss</button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Contribution Score (HERO) ─────────────────────────────────────── */}
      <div className="bg-surface-1 border border-accent/15 rounded-xl p-5">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xs text-accent uppercase tracking-wider font-mono font-medium">Contribution Tracking</h2>
          <Tooltip content="Score = 30% approval efficiency + 20% (100 − denial rate) + 50% output volume (files, edits, commands, lines)">
            <div className="text-right">
              <div className="text-[10px] text-text-tertiary font-mono">Contribution Score</div>
              <div className={`text-3xl font-bold tabular-nums font-mono ${
                contributionScore >= 70 ? 'text-emerald-400' : contributionScore >= 40 ? 'text-amber-400' : 'text-text-tertiary'
              }`}>{contributionScore}</div>
            </div>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div>
            <div className="text-[10px] text-text-tertiary font-mono">Total Actions</div>
            <div className="text-2xl font-bold text-text-primary tabular-nums">{totalActions}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-tertiary font-mono">Files Created</div>
            <div className="text-2xl font-bold text-blue-400 tabular-nums">{contributions?.summary.filesCreated ?? 0}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-tertiary font-mono">Files Edited</div>
            <div className="text-2xl font-bold text-cyan-400 tabular-nums">{contributions?.summary.filesEdited ?? 0}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-tertiary font-mono">Lines Written</div>
            <div className="text-2xl font-bold text-emerald-400 tabular-nums">{contributions?.summary.linesWritten ?? 0}</div>
          </div>
          <div>
            <div className="text-[10px] text-text-tertiary font-mono">Commands</div>
            <div className="text-2xl font-bold text-amber-400 tabular-nums">{contributions?.summary.commandsExecuted ?? 0}</div>
          </div>
        </div>
        {/* 7-day chart with Y-axis */}
        {dailyCounts.length > 0 ? (
          <div>
            <Sparkline data={dailyCounts} color="bg-accent" />
            <div className="flex justify-between mt-1 text-[9px] text-text-tertiary font-mono ml-7">
              <span>{byDay[0]?.date.slice(5)}</span>
              <span>last 7 days</span>
              <span>{byDay[byDay.length - 1]?.date.slice(5)}</span>
            </div>
          </div>
        ) : (
          <div className="h-12 flex items-center text-[10px] text-text-tertiary font-mono">activity chart appears after first day</div>
        )}
        {contributions && (
          <div className="flex gap-6 mt-3 pt-3 border-t border-border/30 text-[10px] text-text-secondary font-mono">
            <Tooltip content="What % of approval requests were approved">
              <span>efficiency: {contributions.summary.approvalEfficiency}</span>
            </Tooltip>
            <Tooltip content="What % of agent actions were denied">
              <span>denial rate: {contributions.summary.denialRate}</span>
            </Tooltip>
            <span>PRs & commits: {contributions.summary.prsAndCommits}</span>
          </div>
        )}
      </div>

      {/* ── Trust + Cost + Categories Row ─────────────────────────────────── */}
      <div className="grid md:grid-cols-3 gap-3">
        {/* Trust */}
        <Tooltip content="Based on approval history, denied actions, and AI anomaly detection. 0 = untrusted, 100 = fully autonomous.">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">Trust Score</div>
            <div className="flex items-center gap-3">
              <span className={`text-3xl font-bold tabular-nums font-mono ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {trust}
              </span>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${trust > 70 ? 'bg-emerald-500' : trust > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                    style={{ width: `${trust}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[8px] text-text-tertiary font-mono">
                  <span>untrusted</span><span>autonomous</span>
                </div>
              </div>
            </div>
          </div>
        </Tooltip>

        {/* Cost */}
        <Tooltip content="Estimated cost from tool execution heuristics. Actual LLM costs may vary.">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">Cost</div>
            <div className="text-3xl font-bold text-text-primary font-mono tabular-nums">${totalCost.toFixed(2)}</div>
            <div className="text-[10px] text-text-secondary mt-1 font-mono">
              this week: ${(cost?.costThisWeek ?? 0).toFixed(2)}
            </div>
          </div>
        </Tooltip>

        {/* Categories — PIE CHART */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">Action Categories</div>
          {mission?.categoryBreakdown && Object.keys(mission.categoryBreakdown).length > 0 ? (
            <PieChart breakdown={mission.categoryBreakdown} />
          ) : (
            <p className="text-[10px] text-text-tertiary font-mono mt-2">no category data yet</p>
          )}
        </div>
      </div>

      {/* ── Network Board ─────────────────────────────────────────────────── */}
      <NetworkBoard mission={mission} instances={allInstances ?? []} />

      {/* ── Recent Activity ───────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">Recent Activity</h3>
          <Link to="/activity" className="text-[10px] text-accent hover:text-accent-bright font-mono">all →</Link>
        </div>
        {!activity?.data.length ? (
          <div className="p-8 text-center font-mono">
            <div className="text-text-tertiary text-xs" style={{ animation: 'breathe 4s ease-in-out infinite' }}>( o_o ) no actions yet</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activity.data.slice(0, 10).map(item => (
              <div key={item.id} className="px-4 py-2.5 flex items-center gap-3 text-xs hover:bg-surface-2/30 transition-colors">
                <span className="text-[10px] text-text-tertiary w-[55px] shrink-0 font-mono tabular-nums">
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-text-primary truncate flex-1">{item.humanDescription}</span>
                <span className={`text-[10px] font-mono font-medium ${
                  item.status === 'denied' ? 'text-red-400' : item.status === 'pending' ? 'text-amber-400' : 'text-emerald-400'
                }`}>{item.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showRoleModal && <RoleModal instance={instance} onClose={() => setShowRoleModal(false)} />}
      </div>
    </div>
  );
}
