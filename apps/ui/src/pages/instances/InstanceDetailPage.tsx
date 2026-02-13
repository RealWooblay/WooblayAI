/**
 * Instance Detail — Deep dive into a single agent.
 *
 * Trust-based weather. Alive ASCII character. Inline identity editing.
 * Contribution tracking hero. Agent network with sub-agents.
 * Hybrid Identity: base role → agent-evolved SOUL.md tracking.
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
import { WeatherBackground, trustToWeather } from '../../components/weather/WeatherBackground.tsx';

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
            <circle key={cat} cx="50" cy="50" r={radius} fill="none"
              stroke={CAT_COLOR[cat] ?? '#52525b'} strokeWidth="16"
              strokeDasharray={`${dashLength} ${circumference - dashLength}`}
              strokeDashoffset={dashOffset} style={{ transition: 'all 0.5s ease' }} />
          );
        })}
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

// ── Sparkline ─────────────────────────────────────────────────────────────────

function Sparkline({ data, color = 'bg-accent' }: { data: number[]; color?: string }) {
  const max = Math.max(...data, 1);
  const hasActivity = data.some(v => v > 0);
  return (
    <div className="flex items-end gap-1">
      <div className="flex flex-col justify-between h-16 mr-1 text-[8px] text-text-tertiary font-mono tabular-nums shrink-0 w-5 text-right">
        <span>{max}</span>
        <span>{Math.round(max / 2)}</span>
        <span>0</span>
      </div>
      <div className="flex items-end gap-[3px] h-16 flex-1 border-b border-l border-border/30 pb-px pl-px relative">
        {data.map((v, i) => (
          <Tooltip key={i} content={`${v} actions`}>
            <div
              className={`flex-1 rounded-t-sm transition-all min-w-[6px] ${
                v > 0 ? `${color} opacity-80 hover:opacity-100` : 'bg-surface-3 opacity-40'
              }`}
              style={{ height: `${v > 0 ? Math.max((v / max) * 100, 8) : 3}%` }}
            />
          </Tooltip>
        ))}
        {!hasActivity && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-text-tertiary font-mono">no actions this week</span>
          </div>
        )}
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
        <div className="text-zinc-600 text-2xl">( -_- ) zzz</div>
        <div className="text-[10px] text-zinc-600 mt-1">offline</div>
      </div>
    );
  }
  if (!mission) {
    return (
      <div className="font-mono text-center animate-pulse">
        <div className="text-zinc-500 text-2xl">( . . )</div>
        <div className="text-[10px] text-zinc-500 mt-1">connecting</div>
      </div>
    );
  }

  const trust = mission.trustScore ?? 50;
  const isWorking = mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';
  const hasPending = (mission.blockedActions ?? 0) > 0;
  const e = blink ? '-' : 'o';
  let face: string, color: string, label: string, speed = '4s';

  if (hasPending) { face = `( ${blink ? '-' : '?'}_${blink ? '-' : '?'} )`; color = 'text-amber-400'; label = 'needs input'; speed = '2.5s'; }
  else if (trust <= 20) { face = `( ${blink ? '-' : 'x'}_${blink ? '-' : 'x'} )`; color = 'text-red-400'; label = 'struggling'; speed = '1.5s'; }
  else if (trust <= 40) { face = `( ${blink ? '-' : '.'}_.${blink ? '' : ' '})`; color = 'text-orange-400'; label = 'concerned'; speed = '2s'; }
  else if (trust <= 60) { face = isWorking ? `( ${blink ? '-' : e}_${blink ? '-' : e})>` : `( ${e}_${e} )`; color = isWorking ? 'text-blue-400' : 'text-text-secondary'; label = isWorking ? mission.currentStep : 'standing by'; speed = isWorking ? '2s' : '4s'; }
  else if (trust <= 80) { face = `( ${blink ? '-' : '•'}‿${blink ? '-' : '•'} )`; color = 'text-emerald-400'; label = isWorking ? mission.currentStep : 'happy'; speed = '3.5s'; }
  else { face = `( ${blink ? '-' : '★'}‿${blink ? '-' : '★'} )`; color = 'text-violet-400'; label = isWorking ? mission.currentStep : 'thriving'; speed = '3s'; }

  return (
    <div className="font-mono text-center" style={{ animation: `breathe ${speed} ease-in-out infinite` }}>
      <div className={`${color} text-2xl`}>{face}</div>
      <div className={`text-[10px] ${color} mt-1 truncate max-w-[200px]`}>
        {label}{!hasPending && !isWorking && <span className="animate-blink"> _</span>}
      </div>
    </div>
  );
}

// ── Inline Identity Editor (no modals!) ──────────────────────────────────────

function IdentitySection({ instance, mission }: { instance: Instance; mission?: MissionData }) {
  const qc = useQueryClient();
  const identity = mission?.identity;
  const source = identity?.source ?? 'none';

  // Inline edit states
  const [editingRole, setEditingRole] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [roleVal, setRoleVal] = useState('');
  const [goalVal, setGoalVal] = useState('');
  const [showSoul, setShowSoul] = useState(false);

  const roleMutation = useMutation({
    mutationFn: (role: string) => updateInstance(instance.id, { role } as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['instance', instance.id] }); qc.invalidateQueries({ queryKey: ['mission', instance.id] }); setEditingRole(false); },
  });
  const goalMutation = useMutation({
    mutationFn: (goal: string) => updateInstance(instance.id, { goal } as any),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mission', instance.id] }); setEditingGoal(false); },
  });

  const currentRole = identity?.baseRole ?? mission?.role ?? instance.role ?? null;
  const currentGoal = mission?.goal && mission.goal !== instance.name ? mission.goal : null;

  const sourceColors: Record<string, string> = {
    'user-set': 'text-accent',
    'ai-inferred': 'text-violet-400',
    'agent-evolved': 'text-emerald-400',
    'none': 'text-text-tertiary',
  };
  const sourceLabels: Record<string, string> = {
    'user-set': 'set by you',
    'ai-inferred': 'AI inferred',
    'agent-evolved': 'agent evolved',
    'none': 'not configured',
  };

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">Agent Identity</h3>
        <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full bg-surface-3 ${sourceColors[source]}`}>
          {sourceLabels[source]}
        </span>
      </div>

      {/* ── Role (inline editable) ──────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <span className="text-[10px] text-text-tertiary font-mono w-12 shrink-0 pt-1">role</span>
        {editingRole ? (
          <div className="flex-1 flex gap-2">
            <input
              autoFocus
              value={roleVal}
              onChange={e => setRoleVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && roleVal.trim()) roleMutation.mutate(roleVal); if (e.key === 'Escape') setEditingRole(false); }}
              placeholder="e.g. Frontend developer building React dashboard"
              className="flex-1 bg-surface-0 border border-accent/40 rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent"
            />
            <button onClick={() => roleMutation.mutate(roleVal)} disabled={!roleVal.trim() || roleMutation.isPending}
              className="px-3 py-1.5 bg-accent hover:bg-accent-bright text-white text-[10px] rounded-lg font-medium disabled:opacity-40 shrink-0">
              {roleMutation.isPending ? '...' : 'save'}
            </button>
            <button onClick={() => setEditingRole(false)} className="text-[10px] text-text-tertiary hover:text-text-secondary px-1">✕</button>
          </div>
        ) : (
          <button
            onClick={() => { setRoleVal(currentRole ?? ''); setEditingRole(true); }}
            className="flex-1 text-left text-xs font-mono text-text-primary hover:text-accent transition-colors group"
          >
            {currentRole ?? <span className="text-text-tertiary italic">click to set role...</span>}
            <span className="text-[9px] text-text-tertiary opacity-0 group-hover:opacity-100 ml-2">edit</span>
          </button>
        )}
      </div>

      {/* ── AI Inferred (if different from base) ───────────────────────── */}
      {identity?.inferredRole && identity.inferredRole !== currentRole && (
        <div className="flex items-start gap-3">
          <span className="text-[10px] text-text-tertiary font-mono w-12 shrink-0 pt-0.5">ai sees</span>
          <span className="text-xs text-violet-400/80 font-mono">{identity.inferredRole}</span>
        </div>
      )}

      {/* ── Goal (inline editable) ──────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <span className="text-[10px] text-text-tertiary font-mono w-12 shrink-0 pt-1">goal</span>
        {editingGoal ? (
          <div className="flex-1 flex gap-2">
            <input
              autoFocus
              value={goalVal}
              onChange={e => setGoalVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && goalVal.trim()) goalMutation.mutate(goalVal); if (e.key === 'Escape') setEditingGoal(false); }}
              placeholder="e.g. Build the settings page with dark mode"
              className="flex-1 bg-surface-0 border border-accent/40 rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent"
            />
            <button onClick={() => goalMutation.mutate(goalVal)} disabled={!goalVal.trim() || goalMutation.isPending}
              className="px-3 py-1.5 bg-accent hover:bg-accent-bright text-white text-[10px] rounded-lg font-medium disabled:opacity-40 shrink-0">
              {goalMutation.isPending ? '...' : 'save'}
            </button>
            <button onClick={() => setEditingGoal(false)} className="text-[10px] text-text-tertiary hover:text-text-secondary px-1">✕</button>
          </div>
        ) : (
          <button
            onClick={() => { setGoalVal(currentGoal ?? ''); setEditingGoal(true); }}
            className="flex-1 text-left text-xs font-mono text-text-secondary hover:text-accent transition-colors group"
          >
            {currentGoal ?? <span className="text-text-tertiary italic">click to set goal...</span>}
            <span className="text-[9px] text-text-tertiary opacity-0 group-hover:opacity-100 ml-2">edit</span>
          </button>
        )}
      </div>

      {/* ── Evolved SOUL.md (agent's self-description) ─────────────────── */}
      {identity?.evolvedSoul && (
        <div className="pt-3 border-t border-border/30">
          <button
            onClick={() => setShowSoul(!showSoul)}
            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-mono flex items-center gap-1.5 w-full"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Agent evolved its SOUL.md
            {identity.identityLastUpdated && (
              <span className="text-text-tertiary">· {new Date(identity.identityLastUpdated).toLocaleDateString()}</span>
            )}
            <span className="ml-auto">{showSoul ? '▾' : '▸'}</span>
          </button>
          {showSoul && (
            <pre className="mt-2 p-3 bg-surface-0 rounded-lg text-[10px] text-text-secondary font-mono whitespace-pre-wrap max-h-48 overflow-y-auto border border-border/30 animate-fade-in">
              {identity.evolvedSoul}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Agent Network (slick tree view) ──────────────────────────────────────────

function AgentNetwork({ mission, instances }: { mission?: MissionData; instances: Instance[] }) {
  if (!mission) return null;
  const subAgents = mission.subAgents ?? [];
  const others = instances.filter(i => i.id !== mission.instanceId && i.status === 'running');
  const activeCount = subAgents.filter(s => s.status !== 'awaiting_approval').length;
  const waitingCount = subAgents.filter(s => s.status === 'awaiting_approval').length;

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">Agent Network</h3>
        {subAgents.length > 0 && (
          <span className="text-[9px] font-mono text-text-secondary bg-surface-3 px-2 py-0.5 rounded-full">
            {activeCount} active{waitingCount > 0 ? ` · ${waitingCount} waiting` : ''}
          </span>
        )}
      </div>

      <div className="font-mono text-[11px] space-y-1">
        {/* Main agent */}
        <div className="border border-accent/20 bg-accent/[0.03] rounded-lg p-3 flex items-center gap-3">
          <span className="text-accent text-[10px]">●</span>
          <div className="flex-1 min-w-0">
            <span className="text-text-primary font-medium">{mission.instanceName}</span>
            <span className="text-text-tertiary text-[10px] ml-2">main</span>
          </div>
          <span className="text-text-tertiary text-[10px]">
            trust:{mission.trustScore ?? 0} · ${(Number(mission.estimatedCost) || 0).toFixed(2)}
          </span>
        </div>

        {/* Sub-agents tree */}
        {subAgents.length > 0 && (
          <div className="pl-4 space-y-1 pt-1">
            {subAgents.map((sa, i) => {
              const isLast = i === subAgents.length - 1;
              const isWaiting = sa.status === 'awaiting_approval';
              return (
                <div key={sa.sessionId} className="flex items-start gap-2">
                  <span className="text-border mt-2 text-[10px] select-none">{isLast ? '└─' : '├─'}</span>
                  <div className={`flex-1 border rounded-lg p-2.5 transition-colors ${
                    isWaiting ? 'border-amber-500/25 bg-amber-500/[0.03]' : 'border-border/50'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${isWaiting ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
                      <span className="text-text-secondary text-[10px]">{sa.sessionId.slice(0, 8)}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                        isWaiting ? 'bg-amber-500/10 text-amber-400' : 'bg-emerald-500/10 text-emerald-400'
                      }`}>{isWaiting ? 'waiting' : 'active'}</span>
                    </div>
                    <p className="text-[10px] text-text-secondary mt-1 truncate">{sa.lastAction}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Other running agents */}
        {others.length > 0 && (
          <div className="mt-3 pt-3 border-t border-border/30">
            <div className="text-text-tertiary text-[10px] mb-2">other agents on this platform</div>
            <div className="flex flex-wrap gap-2">
              {others.map(inst => (
                <Link key={inst.id} to={`/instances/${inst.id}`}
                  className="border border-border/50 rounded-lg px-3 py-1.5 text-[10px] text-text-secondary hover:text-accent hover:border-accent/20 transition-colors">
                  {inst.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {subAgents.length === 0 && others.length === 0 && (
          <div className="text-text-tertiary text-[10px] py-2">solo agent — no sub-agents spawned</div>
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();

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

  const byDay = contributions?.byDay ?? [];
  const dailyCounts = byDay.map(d => d.count);
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const trust = mission?.trustScore ?? 50;
  const totalCost = Number(cost?.costToday ?? mission?.estimatedCost ?? 0) || 0;
  const summary = contributions?.summary;
  const totalActions = summary?.totalActions ?? mission?.progress?.total ?? 0;
  const weather = useMemo(() => trustToWeather(trust), [trust]);

  const contributionScore = useMemo(() => {
    if (!summary || summary.totalActions === 0) return 0;
    const efficiency = parseFloat(summary.approvalEfficiency) || 0;
    const denialRate = parseFloat(summary.denialRate) || 0;
    const outputScore = Math.min(100, ((summary.filesCreated ?? 0) * 5 + (summary.filesEdited ?? 0) * 3 + (summary.commandsExecuted ?? 0) * 2 + (summary.linesWritten ?? 0) * 0.1));
    return Math.round(Math.min(100, (efficiency * 0.3 + (100 - denialRate) * 0.2 + outputScore * 0.5)));
  }, [summary]);

  return (
    <div className="relative">
      <WeatherBackground weather={weather} />

      <div className="max-w-5xl mx-auto space-y-5 relative z-10">
      <Link to="/" className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors font-mono">← dashboard</Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <div className="flex items-start gap-6">
          <AgentCharacter mission={mission} instance={instance} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-lg font-bold text-text-primary font-mono">{instance.name}</h1>
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium font-mono ${
                instance.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-500'
              }`}>{instance.status}</span>
              {(mission?.subAgents?.length ?? 0) > 0 && (
                <span className="text-[9px] font-mono text-text-secondary bg-surface-3 px-1.5 py-0.5 rounded-full">
                  +{mission!.subAgents.length} sub-agent{mission!.subAgents.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {mission?.role && <p className="text-xs text-text-secondary font-mono">role: {mission.role}</p>}
            {mission?.goal && mission.goal !== instance.name && (
              <p className="text-[10px] text-text-tertiary font-mono mt-0.5">goal: {mission.goal}</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Identity (inline editing, no modals) ──────────────────────────── */}
      <IdentitySection instance={instance} mission={mission} />

      {/* ── Anomaly Alerts ─────────────────────────────────────────────────── */}
      {criticalFlags.length > 0 && (
        <div className="space-y-1.5">
          {criticalFlags.slice(0, 3).map(flag => (
            <div key={flag.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-3">
              <div className="flex items-start gap-3">
                <span className="font-mono text-red-400 text-[10px] font-bold shrink-0 mt-0.5">[{flag.severity}]</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-red-300 font-medium">{flag.title}</p>
                  <p className="text-[10px] text-red-400/70 mt-0.5 truncate">{flag.description?.split('\n')[0]}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <Link to="/activity" className="text-[10px] text-red-300 font-medium hover:text-red-200 font-mono">view activity →</Link>
                    <button onClick={() => dismissMutation.mutate(flag.id)} className="text-[10px] text-red-400/30 hover:text-red-400/70 font-mono">dismiss</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Contribution Hero ─────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-accent/15 rounded-xl p-5">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-xs text-accent uppercase tracking-wider font-mono font-medium">Contribution Tracking</h2>
          <Tooltip content="Score = 30% approval efficiency + 20% (100 − denial rate) + 50% output volume">
            <div className="text-right">
              <div className="text-[10px] text-text-tertiary font-mono">Score</div>
              <div className={`text-3xl font-bold tabular-nums font-mono ${
                contributionScore >= 70 ? 'text-emerald-400' : contributionScore >= 40 ? 'text-amber-400' : 'text-text-tertiary'
              }`}>{contributionScore}</div>
            </div>
          </Tooltip>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
          <div><div className="text-[10px] text-text-tertiary font-mono">Actions</div><div className="text-2xl font-bold text-text-primary tabular-nums">{totalActions}</div></div>
          <div><div className="text-[10px] text-text-tertiary font-mono">Files Created</div><div className="text-2xl font-bold text-blue-400 tabular-nums">{summary?.filesCreated ?? 0}</div></div>
          <div><div className="text-[10px] text-text-tertiary font-mono">Files Edited</div><div className="text-2xl font-bold text-cyan-400 tabular-nums">{summary?.filesEdited ?? 0}</div></div>
          <div><div className="text-[10px] text-text-tertiary font-mono">Lines Written</div><div className="text-2xl font-bold text-emerald-400 tabular-nums">{summary?.linesWritten ?? 0}</div></div>
          <div><div className="text-[10px] text-text-tertiary font-mono">Commands</div><div className="text-2xl font-bold text-amber-400 tabular-nums">{summary?.commandsExecuted ?? 0}</div></div>
        </div>
        {dailyCounts.length > 0 ? (
          <div className="relative">
            <Sparkline data={dailyCounts} color="bg-accent" />
            <div className="flex justify-between mt-1 text-[9px] text-text-tertiary font-mono ml-7">
              <span>{byDay[0]?.date?.slice(5)}</span><span>last 7 days</span><span>{byDay[byDay.length - 1]?.date?.slice(5)}</span>
            </div>
          </div>
        ) : (
          <div className="h-16 flex items-center text-[10px] text-text-tertiary font-mono">activity chart appears after first day</div>
        )}
        {summary && (
          <div className="flex gap-6 mt-3 pt-3 border-t border-border/30 text-[10px] text-text-secondary font-mono">
            <Tooltip content="What % of approval requests were approved"><span>efficiency: {summary.approvalEfficiency ?? '—'}</span></Tooltip>
            <Tooltip content="What % of agent actions were denied"><span>denial rate: {summary.denialRate ?? '—'}</span></Tooltip>
            <span>PRs: {summary.prsAndCommits ?? 0}</span>
          </div>
        )}
      </div>

      {/* ── Trust + Cost + Categories ─────────────────────────────────────── */}
      <div className="grid md:grid-cols-3 gap-3">
        <Tooltip content="Based on approval history, denied actions, and AI anomaly detection.">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">Trust</div>
            <div className="flex items-center gap-3">
              <span className={`text-3xl font-bold tabular-nums font-mono ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>{trust}</span>
              <div className="flex-1">
                <div className="h-2 rounded-full bg-surface-3 overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${trust > 70 ? 'bg-emerald-500' : trust > 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${trust}%` }} />
                </div>
              </div>
            </div>
          </div>
        </Tooltip>

        <Tooltip content="Estimated cost from tool execution heuristics.">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">Cost</div>
            <div className="text-3xl font-bold text-text-primary font-mono tabular-nums">${totalCost.toFixed(2)}</div>
            <div className="text-[10px] text-text-secondary mt-1 font-mono">week: ${(cost?.costThisWeek ?? 0).toFixed(2)}</div>
          </div>
        </Tooltip>

        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">Categories</div>
          {mission?.categoryBreakdown && Object.keys(mission.categoryBreakdown).length > 0 ? (
            <PieChart breakdown={mission.categoryBreakdown} />
          ) : (
            <p className="text-[10px] text-text-tertiary font-mono mt-2">no data yet</p>
          )}
        </div>
      </div>

      {/* ── Agent Network ─────────────────────────────────────────────────── */}
      <AgentNetwork mission={mission} instances={allInstances ?? []} />

      {/* ── Recent Activity ───────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">Recent Activity</h3>
          <Link to="/activity" className="text-[10px] text-accent hover:text-accent-bright font-mono">all →</Link>
        </div>
        {!activity?.data?.length ? (
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

      </div>
    </div>
  );
}
