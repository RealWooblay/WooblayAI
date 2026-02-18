/**
 * Instance Detail — Deep dive into a single agent.
 *
 * Trust-based weather. Alive ASCII character. Inline identity editing.
 * Contribution tracking hero. Agent network with sub-agents.
 * Hybrid Identity: base role → agent-evolved SOUL.md tracking.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
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
  listFiles,
  readFile,
  writeFile,
  getFileDownloadUrl,
  getInstanceSecrets,
  addInstanceSecret,
  deleteInstanceSecret,
  type FileEntry,
  type MissionData,
  type Instance,
} from '../../api/client.ts';
import { WeatherBackground, trustToWeather } from '../../components/weather/WeatherBackground.tsx';
import { useTourOptional } from '../../contexts/TourContext.tsx';

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
    <div className="flex flex-col gap-3 w-full">
      <div className="flex items-center gap-5">
        <svg width="88" height="88" viewBox="0 0 100 100" className="shrink-0">
          {sorted.map(([cat, count]) => {
            const pct = count / total;
            const dashLength = pct * circumference;
            const dashOffset = -offset * circumference;
            offset += pct;
            return (
              <circle key={cat} cx="50" cy="50" r={radius} fill="none"
                stroke={CAT_COLOR[cat] ?? '#52525b'} strokeWidth="14"
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={dashOffset} style={{ transition: 'all 0.5s ease' }} />
            );
          })}
          <text x="50" y="46" textAnchor="middle" className="fill-text-primary font-bold font-mono" style={{ fontSize: '16px' }}>{total}</text>
          <text x="50" y="59" textAnchor="middle" className="fill-text-tertiary font-mono" style={{ fontSize: '8px' }}>actions</text>
        </svg>
        <div className="flex flex-col gap-1.5 min-w-0">
          {sorted.slice(0, 6).map(([cat, count]) => (
            <div key={cat} className="flex items-center gap-2 text-[11px] text-text-secondary">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: CAT_COLOR[cat] ?? '#52525b' }} />
              <span className="truncate">{CAT_LABEL[cat] ?? cat}</span>
              <span className="text-text-tertiary tabular-nums ml-auto shrink-0">{count}</span>
              <span className="text-text-muted tabular-nums shrink-0 w-8 text-right">{Math.round((count / total) * 100)}%</span>
            </div>
          ))}
          {sorted.length > 6 && (
            <span className="text-[10px] text-text-muted">+{sorted.length - 6} more</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sparkline — tiny inline chart ─────────────────────────────────────────────

function Sparkline({ data, color = '#6366f1', height = 32, width = 120 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const pad = 2;
  const w = width;
  const h = height;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (1 - (v - min) / range) * (h - pad * 2);
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1].x.toFixed(1)},${h - pad} L${points[0].x.toFixed(1)},${h - pad} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
      <path d={areaPath} fill={color} opacity="0.08" />
      <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="2" fill={color} />
    </svg>
  );
}

// ── Activity Chart (SVG line + bars) ──────────────────────────────────────────

function ActivityChart({ data, labels }: { data: number[]; labels: string[] }) {
  const max = Math.max(...data, 1);
  const w = 440;
  const h = 160;
  const padL = 48;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const chartW = w - padL - padR;
  const chartH = h - padT - padB;

  // Y-axis tick values: 0, mid, max
  const yTicks = [0, Math.round(max / 2), max];

  // Build SVG path
  const points = data.map((v, i) => {
    const x = padL + (data.length > 1 ? (i / (data.length - 1)) * chartW : chartW / 2);
    const y = padT + chartH - (v / max) * chartH;
    return { x, y, v };
  });
  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1].x},${padT + chartH} L${points[0].x},${padT + chartH} Z`;

  return (
    <div className="relative mt-1">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: 140 }}>
        {/* Horizontal grid lines + Y labels */}
        {yTicks.map((tick) => {
          const y = padT + chartH - (tick / max) * chartH;
          return (
            <g key={tick}>
              <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="rgba(255,255,255,0.05)" strokeWidth="1" strokeDasharray={tick === 0 ? 'none' : '4 4'} />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill="#555570" style={{ fontSize: '11px', fontFamily: 'monospace' }}>
                {tick}
              </text>
            </g>
          );
        })}

        {/* Y-axis line */}
        <line x1={padL} y1={padT} x2={padL} y2={padT + chartH} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        {/* Area fill */}
        <path d={areaPath} fill="rgba(99,102,241,0.08)" />

        {/* Line */}
        <path d={linePath} fill="none" stroke="rgba(99,102,241,0.7)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Dots */}
        {points.map((p, i) => (
          <g key={i}>
            {p.v > 0 && <circle cx={p.x} cy={p.y} r="6" fill="rgba(99,102,241,0.1)" />}
            <circle cx={p.x} cy={p.y} r={p.v > 0 ? 3 : 2} fill={p.v > 0 ? '#6366f1' : 'rgba(99,102,241,0.3)'} />
          </g>
        ))}

        {/* X-axis labels */}
        {data.length > 1 && labels.length >= 2 && (
          <>
            <text x={points[0].x} y={padT + chartH + 18} textAnchor="middle" fill="#555570" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
              {labels[0]}
            </text>
            <text x={points[points.length - 1].x} y={padT + chartH + 18} textAnchor="middle" fill="#555570" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
              {labels[labels.length - 1]}
            </text>
          </>
        )}

        {/* Center label */}
        <text x={padL + chartW / 2} y={padT + chartH + 18} textAnchor="middle" fill="#33334880" style={{ fontSize: '10px', fontFamily: 'monospace' }}>
          last 7 days
        </text>
      </svg>
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
        <div className="text-zinc-600 text-lg leading-none">( -_- )</div>
        <div className="text-[9px] text-zinc-600 mt-1">offline</div>
      </div>
    );
  }
  if (!mission) {
    return (
      <div className="font-mono text-center animate-pulse">
        <div className="text-zinc-500 text-lg leading-none">( . . )</div>
        <div className="text-[9px] text-zinc-500 mt-1">connecting</div>
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
      <div className={`${color} text-lg leading-none`}>{face}</div>
      <div className={`text-[9px] ${color} mt-1.5 truncate max-w-[72px]`}>
        {label}{!hasPending && !isWorking && <span className="animate-blink"> _</span>}
      </div>
    </div>
  );
}

// ── Agent Network (slick tree view) ──────────────────────────────────────────

function AgentNetwork({ mission, instances }: { mission?: MissionData; instances: Instance[] }) {
  if (!mission) return null;
  const subAgents = mission.subAgents ?? [];
  const others = instances.filter(i => i.id !== mission.instanceId && i.status === 'running');
  const activeCount = subAgents.filter(s => s.status === 'active').length;
  const waitingCount = subAgents.filter(s => s.status === 'awaiting_approval').length;
  const completedCount = subAgents.filter(s => s.status === 'completed').length;
  const spawningCount = subAgents.filter(s => s.status === 'spawning').length;

  const statusColor = (status: string) => {
    switch (status) {
      case 'active': return { dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400', label: 'active' };
      case 'awaiting_approval': return { dot: 'bg-amber-400 animate-pulse', badge: 'bg-amber-500/10 text-amber-400', label: 'waiting' };
      case 'completed': return { dot: 'bg-zinc-400', badge: 'bg-zinc-500/10 text-zinc-400', label: 'done' };
      case 'spawning': return { dot: 'bg-blue-400 animate-pulse', badge: 'bg-blue-500/10 text-blue-400', label: 'spawning' };
      default: return { dot: 'bg-zinc-600', badge: 'bg-zinc-500/10 text-zinc-500', label: status };
    }
  };

  const statParts: string[] = [];
  if (activeCount > 0) statParts.push(`${activeCount} active`);
  if (waitingCount > 0) statParts.push(`${waitingCount} waiting`);
  if (spawningCount > 0) statParts.push(`${spawningCount} spawning`);
  if (completedCount > 0) statParts.push(`${completedCount} done`);

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">Agent Network</h3>
        {subAgents.length > 0 && (
          <span className="text-[10px] font-mono text-text-secondary bg-surface-3 px-2.5 py-0.5 rounded-full">
            {statParts.join(' · ')}
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
              const sc = statusColor(sa.status);
              return (
                <div key={sa.sessionId} className="flex items-start gap-2">
                  <span className="text-border mt-2 text-[10px] select-none">{isLast ? '└─' : '├─'}</span>
                  <div className={`flex-1 border rounded-lg p-2.5 transition-colors ${
                    sa.status === 'awaiting_approval' ? 'border-amber-500/25 bg-amber-500/[0.03]' :
                    sa.status === 'active' ? 'border-emerald-500/15 bg-emerald-500/[0.02]' :
                    'border-border/50'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                      <span className="text-text-secondary text-[10px]">{sa.sessionId.slice(0, 12)}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${sc.badge}`}>{sc.label}</span>
                      {(sa as any).toolCallCount > 0 && (
                        <span className="text-[9px] text-text-tertiary">{(sa as any).toolCallCount} actions</span>
                      )}
                      {(sa as any).spawned && (
                        <span className="text-[9px] text-blue-400/60">spawned</span>
                      )}
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

// ── Instance Mini-Tour — auto-triggers on first visit ────────────────────────

const INSTANCE_TOUR_KEY = 'wooblay-instance-tour-seen';

interface MiniTourStep {
  target: string;
  title: string;
  content: string;
  tab?: 'overview' | 'profile' | 'security' | 'workspace';
}

const INSTANCE_TOUR_STEPS: MiniTourStep[] = [
  {
    target: 'tour-instance-header',
    title: 'Meet your agent',
    content: 'Name, status, trust weather, and role. This is your agent\u2019s home base.',
  },
  {
    target: 'tour-tab-overview',
    tab: 'overview',
    title: 'Overview',
    content: 'Trust score, cost, contribution graph, and a live feed of every action.',
  },
  {
    target: 'tour-tab-profile',
    tab: 'profile',
    title: 'Profile',
    content: 'Edit the agent\u2019s name, role, and goal inline. This shapes how it behaves.',
  },
  {
    target: 'tour-tab-security',
    tab: 'security',
    title: 'Security',
    content: 'Add API keys the agent can use directly, or view exec-only secrets it can\u2019t touch.',
  },
  {
    target: 'tour-agent-keys',
    tab: 'security',
    title: 'Agent API keys',
    content: 'Keys here are fully visible to the agent as env vars. Only add what you trust it with.',
  },
  {
    target: 'tour-tab-workspace',
    tab: 'workspace',
    title: 'Workspace',
    content: 'Live file browser into the container. See what the agent is building right now.',
  },
];

function InstanceMiniTour({ setActiveTab }: { setActiveTab: (t: 'overview' | 'profile' | 'security' | 'workspace') => void }) {
  const mainTour = useTourOptional();
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Auto-trigger on first visit (unless main tour is running)
  useEffect(() => {
    if (mainTour?.isActive) return;
    try {
      if (localStorage.getItem(INSTANCE_TOUR_KEY)) return;
    } catch { /* ignore */ }
    const t = setTimeout(() => setActive(true), 600);
    return () => clearTimeout(t);
  }, [mainTour?.isActive]);

  const step = active ? INSTANCE_TOUR_STEPS[idx] : null;

  // Switch tab when step changes
  useEffect(() => {
    if (step?.tab) setActiveTab(step.tab);
  }, [step, setActiveTab]);

  // Measure target
  useEffect(() => {
    if (!step) { setRect(null); return; }
    const t = setTimeout(() => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) { setRect(null); return; }
      const r = el.getBoundingClientRect();
      const pad = 10;
      setRect(new DOMRect(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2));
    }, 150);
    return () => clearTimeout(t);
  }, [step, idx]);

  // Re-measure on scroll/resize
  useEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      const pad = 10;
      setRect(new DOMRect(r.left - pad, r.top - pad, r.width + pad * 2, r.height + pad * 2));
    };
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure); };
  }, [step, idx]);

  const finish = useCallback(() => {
    setActive(false);
    try { localStorage.setItem(INSTANCE_TOUR_KEY, 'true'); } catch { /* ignore */ }
  }, []);

  if (!active || !step) return null;

  const total = INSTANCE_TOUR_STEPS.length;
  const pct = ((idx + 1) / total) * 100;

  return (
    <div className="fixed inset-0 z-[9998] pointer-events-auto">
      {!rect && <div className="absolute inset-0 bg-black/60" aria-hidden />}
      {rect && (
        <div className="absolute rounded-xl border-2 border-accent/80 bg-transparent transition-all duration-300 ease-out"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6), 0 0 30px 4px rgba(99,102,241,0.15)' }} />
      )}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-full max-w-[420px] px-4">
        <div className="bg-surface-1 border border-accent/20 rounded-2xl shadow-2xl overflow-hidden"
          style={{ boxShadow: '0 0 40px 8px rgba(99,102,241,0.08), 0 25px 50px -12px rgba(0,0,0,0.5)' }}>
          <div className="h-[3px] bg-surface-2">
            <div className="h-full bg-gradient-to-r from-accent to-accent-bright transition-all duration-300 ease-out rounded-full" style={{ width: `${pct}%` }} />
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-accent/70 font-medium tabular-nums">{idx + 1}/{total}</span>
                <h3 className="text-[15px] font-semibold text-text-primary leading-tight">{step.title}</h3>
              </div>
              <button type="button" onClick={finish}
                className="text-[10px] text-text-muted hover:text-text-secondary font-mono transition-colors">skip</button>
            </div>
            <p className="text-[13px] text-text-secondary leading-relaxed">{step.content}</p>
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={() => idx > 0 && setIdx(idx - 1)} disabled={idx === 0}
                className="text-[12px] font-mono text-text-tertiary hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors">
                {'\u2190'} back
              </button>
              <button type="button"
                onClick={() => idx < total - 1 ? setIdx(idx + 1) : finish()}
                className="px-5 py-2 rounded-lg bg-accent hover:bg-accent-bright text-white text-[12px] font-mono font-medium transition-colors shadow-lg shadow-accent/20">
                {idx === total - 1 ? 'got it \u2713' : 'next \u2192'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Security Tab — Instance env vars + exec-only summary ─────────────────────

function CapabilitiesSection({ instance }: { instance: Instance }) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  // Instance-level secrets (no connection required)
  const { data: secretsData, isLoading: secretsLoading } = useQuery({
    queryKey: ['instance-secrets', instance.id],
    queryFn: () => getInstanceSecrets(instance.id),
  });

  const addMut = useMutation({
    mutationFn: () => addInstanceSecret(instance.id, {
      key: newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
      value: newValue,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance-secrets', instance.id] });
      setNewKey('');
      setNewValue('');
    },
  });

  const delMut = useMutation({
    mutationFn: (key: string) => deleteInstanceSecret(instance.id, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instance-secrets', instance.id] }),
  });

  const existingKeys = secretsData?.secrets ?? [];

  return (
    <div className="space-y-4">
      {/* Agent Environment Variables */}
      <div className="bg-surface-1 border border-border rounded-xl p-5" data-tour="tour-agent-keys">
        <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono mb-1">
          Agent Environment Variables
        </h3>
        <p className="text-[10px] text-text-muted mb-4">
          Injected as <code className="bg-surface-2 px-1 rounded">$KEY_NAME</code> into the agent container. No connection required.
        </p>

        {/* Warning */}
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-4 py-3 mb-4">
          <p className="text-[11px] text-amber-400 font-medium mb-1">
            These keys are fully visible to the agent.
          </p>
          <p className="text-[10px] text-amber-400/70">
            The agent can read, use, and potentially exfiltrate these credentials. Only add keys here if you
            trust the agent with direct access. For sensitive credentials, use{' '}
            <Link to="/credentials" className="underline hover:text-amber-300">exec-only secrets</Link>{' '}
            on the Credentials page instead — the agent never sees those.
          </p>
        </div>

        {/* Existing keys */}
        {secretsLoading ? (
          <div className="text-[10px] text-text-muted font-mono animate-pulse py-3">loading...</div>
        ) : existingKeys.length > 0 ? (
          <div className="space-y-1.5 mb-4">
            {existingKeys.map((s: any) => (
              <div key={s.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2/50 group">
                <div className="flex items-center gap-3">
                  <code className="text-[11px] text-text-primary font-mono">{s.key}</code>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border text-amber-400 bg-amber-500/10 border-amber-500/20">
                    agent env
                  </span>
                </div>
                <button
                  onClick={() => delMut.mutate(s.key)}
                  className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity font-mono"
                >
                  remove
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {/* Add key form */}
        <div className="flex gap-2 items-end">
          <div className="flex-1 min-w-0">
            <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Key</label>
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
              placeholder="OPENAI_API_KEY"
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
            />
          </div>
          <div className="flex-1 min-w-0">
            <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Value</label>
            <input
              type="password"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="sk-..."
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
            />
          </div>
          <button
            onClick={() => addMut.mutate()}
            disabled={!newKey.trim() || !newValue.trim() || addMut.isPending}
            className="shrink-0 px-3 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors"
          >
            {addMut.isPending ? '...' : 'Add'}
          </button>
        </div>
        {addMut.isError && (
          <p className="text-[10px] text-red-400 font-mono mt-2">
            Failed to add — {(addMut.error as any)?.body ?? 'check server logs'}
          </p>
        )}
      </div>

      {/* Quick links */}
      <div className="flex gap-3">
        <Link to="/credentials" className="flex-1 bg-surface-1 border border-border rounded-xl p-4 hover:border-border-bright transition-colors group">
          <p className="text-[11px] font-medium text-text-primary">Credentials</p>
          <p className="text-[10px] text-text-muted mt-0.5">Manage exec-only secrets &amp; services <span className="opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span></p>
        </Link>
        <Link to="/policies" className="flex-1 bg-surface-1 border border-border rounded-xl p-4 hover:border-border-bright transition-colors group">
          <p className="text-[11px] font-medium text-text-primary">Policies</p>
          <p className="text-[10px] text-text-muted mt-0.5">Define what actions need approval <span className="opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span></p>
        </Link>
        <Link to="/audit" className="flex-1 bg-surface-1 border border-border rounded-xl p-4 hover:border-border-bright transition-colors group">
          <p className="text-[11px] font-medium text-text-primary">Audit</p>
          <p className="text-[10px] text-text-muted mt-0.5">Full audit trail <span className="opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span></p>
        </Link>
      </div>
    </div>
  );
}

// ── Profile Tab — SOUL.md + IDENTITY.md ─────────────────────────────────────
//
// Top:    Quick Role + Goal (syncs to DB and can overwrite both files)
// Below:  Live SOUL.md and IDENTITY.md from container — both editable.
// The agent reads SOUL.md as primary context; IDENTITY.md is a compact reference.

/** Parse ## Role and ## Goal from SOUL.md to pre-fill structured fields */
function parseRoleAndGoalFromSoul(content: string): { role: string; goal: string } {
  const roleMatch = content.match(/## Role\s*\n([\s\S]*?)(?=\n## |$)/i);
  const goalMatch = content.match(/## Goal\s*\n([\s\S]*?)(?=\n## |$)/i);
  return {
    role: roleMatch ? roleMatch[1].trim() : '',
    goal: goalMatch ? goalMatch[1].trim() : '',
  };
}

function ProfileTab({ instanceId, instance, isRunning }: { instanceId: string; instance: Instance; isRunning: boolean }) {
  const qc = useQueryClient();
  const config = instance.configJson ? JSON.parse(instance.configJson) : {};

  // ── Structured fields (synced to DB, pre-filled from live SOUL when available)
  const [role, setRole] = useState(instance.role ?? '');
  const [goal, setGoal] = useState(config.goal ?? '');
  const [structDirty, setStructDirty] = useState(false);

  // ── Live files from container ─────────────────────────────────────────────
  const { data: soulData, isLoading: soulLoading } = useQuery({
    queryKey: ['file-content', instanceId, '/root/clawd/SOUL.md'],
    queryFn: () => readFile(instanceId, '/root/clawd/SOUL.md'),
    enabled: isRunning,
  });
  const { data: identityData, isLoading: identityLoading } = useQuery({
    queryKey: ['file-content', instanceId, '/root/clawd/IDENTITY.md'],
    queryFn: () => readFile(instanceId, '/root/clawd/IDENTITY.md'),
    enabled: isRunning,
  });

  const [soulContent, setSoulContent] = useState('');
  const [identityContent, setIdentityContent] = useState('');
  const [soulDirty, setSoulDirty] = useState(false);
  const [identityDirty, setIdentityDirty] = useState(false);
  const [showRawEditors, setShowRawEditors] = useState(true);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  // Sync fetched SOUL.md into editor state
  useEffect(() => {
    if (soulData?.content && !soulDirty) {
      setSoulContent(soulData.content);
      // Pre-fill Role/Goal from live file so form reflects what's in the container
      const { role: r, goal: g } = parseRoleAndGoalFromSoul(soulData.content);
      if (r || g) {
        setRole((prev: string) => (r ? r : prev));
        setGoal((prev: string) => (g ? g : prev));
      }
    }
  }, [soulData, soulDirty]);

  useEffect(() => {
    if (identityData?.content && !identityDirty) setIdentityContent(identityData.content);
  }, [identityData, identityDirty]);

  // Sync instance data into structured fields when instance changes (if we don't have live file data yet)
  useEffect(() => {
    if (!structDirty && !soulData?.content) {
      setRole(instance.role ?? '');
      setGoal(config.goal ?? '');
    }
  }, [instance, structDirty, soulData?.content, config.goal]);

  // ── Save structured fields → DB + generate SOUL.md + write to container
  const saveProfile = useMutation({
    mutationFn: async () => {
      // 1. Update DB (role + goal)
      await updateInstance(instanceId, { role, goal } as any);

      // 2. Generate and write SOUL.md into the running container
      if (isRunning) {
        const soulMd = [
          '# Soul',
          '',
          `You are **${instance.name}**, an AI agent supervised by Wooblay.`,
          '',
          '## Role',
          role || 'No role assigned — awaiting instructions from your supervisor.',
          '',
          '## Principles',
          '- Stay within your assigned role. Actions outside it may be flagged or denied.',
          '- You operate under Wooblay\'s gated tool system — every risky action requires approval.',
          '- Be transparent about what you\'re doing and why.',
          '- You may evolve this file as you learn more about your task. Updates to SOUL.md',
          '  are tracked by Wooblay so your supervisor can see how your identity develops.',
          '',
          '## Goal',
          goal || 'Work according to your role. Await instructions from your supervisor.',
        ].join('\n');

        await writeFile(instanceId, '/root/clawd/SOUL.md', soulMd);

        // Also update IDENTITY.md
        const identityMd = [
          `# Identity — ${instance.name}`,
          '',
          `- **Name:** ${instance.name}`,
          `- **Role:** ${role || 'not set'}`,
          `- **Goal:** ${goal || 'awaiting instructions'}`,
          '- **Supervisor:** Wooblay Gate (all risky actions are gated)',
          '- **Session:** This file was updated by your supervisor. You may update it as you work.',
        ].join('\n');

        await writeFile(instanceId, '/root/clawd/IDENTITY.md', identityMd);
      }
    },
    onSuccess: () => {
      setStructDirty(false);
      setSoulDirty(false);
      setIdentityDirty(false);
      setSaveStatus('Profile saved — SOUL.md + IDENTITY.md updated');
      qc.invalidateQueries({ queryKey: ['instance', instanceId] });
      qc.invalidateQueries({ queryKey: ['instances'] });
      qc.invalidateQueries({ queryKey: ['file-content', instanceId, '/root/clawd/SOUL.md'] });
      qc.invalidateQueries({ queryKey: ['file-content', instanceId, '/root/clawd/IDENTITY.md'] });
      setTimeout(() => setSaveStatus(null), 2500);
    },
    onError: () => setSaveStatus('Failed to save profile'),
  });

  const saveRawSoul = useMutation({
    mutationFn: () => writeFile(instanceId, '/root/clawd/SOUL.md', soulContent),
    onSuccess: () => {
      setSoulDirty(false);
      setSaveStatus('SOUL.md saved');
      qc.invalidateQueries({ queryKey: ['file-content', instanceId, '/root/clawd/SOUL.md'] });
      setTimeout(() => setSaveStatus(null), 2000);
    },
    onError: () => setSaveStatus('Failed to save SOUL.md'),
  });

  const saveRawIdentity = useMutation({
    mutationFn: () => writeFile(instanceId, '/root/clawd/IDENTITY.md', identityContent),
    onSuccess: () => {
      setIdentityDirty(false);
      setSaveStatus('IDENTITY.md saved');
      qc.invalidateQueries({ queryKey: ['file-content', instanceId, '/root/clawd/IDENTITY.md'] });
      setTimeout(() => setSaveStatus(null), 2000);
    },
    onError: () => setSaveStatus('Failed to save IDENTITY.md'),
  });

  if (!isRunning) {
    return (
      <div className="bg-surface-1 border border-border rounded-xl p-12 text-center">
        <pre className="text-text-tertiary font-mono text-lg mb-2">( -_- )</pre>
        <p className="text-text-secondary font-mono text-sm">agent not running</p>
        <p className="text-text-tertiary font-mono text-[10px] mt-1">start the agent to view and edit its profile</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Status bar */}
      {saveStatus && (
        <div className="text-[10px] font-mono text-emerald-400 bg-emerald-500/8 border border-emerald-500/20 rounded-lg px-3 py-1.5 animate-fade-in">
          {saveStatus}
        </div>
      )}

      {/* ── Quick edit (Role + Goal) ──────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-mono text-text-primary font-medium">Quick edit</h3>
            <p className="text-[9px] text-text-tertiary font-mono mt-0.5">
              Role + Goal sync to DB and to SOUL.md / IDENTITY.md. Fields below are pre-filled from the live files when available.
            </p>
          </div>
          {structDirty && <span className="text-[9px] text-amber-400 font-mono">unsaved</span>}
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[9px] text-text-tertiary font-mono block mb-1">Role</label>
            <input
              value={role}
              onChange={e => { setRole(e.target.value); setStructDirty(true); }}
              placeholder="e.g. Full-stack developer focused on the payments microservice"
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50 placeholder:text-text-tertiary"
            />
          </div>
          <div>
            <label className="text-[9px] text-text-tertiary font-mono block mb-1">Goal</label>
            <textarea
              value={goal}
              onChange={e => { setGoal(e.target.value); setStructDirty(true); }}
              placeholder="e.g. Implement Stripe webhook handlers and write tests for edge cases"
              rows={3}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50 resize-none placeholder:text-text-tertiary"
            />
          </div>
        </div>

        <div className="flex items-center justify-between pt-1 flex-wrap gap-2">
          <p className="text-[9px] text-text-tertiary font-mono">
            <span className="text-amber-400/90">Save profile</span> overwrites SOUL.md and IDENTITY.md with the template above. To keep agent-evolved content, edit the files below instead.
          </p>
          <button
            onClick={() => saveProfile.mutate()}
            disabled={!structDirty || saveProfile.isPending}
            className="px-4 py-1.5 text-[10px] font-mono bg-accent hover:bg-accent-bright text-white rounded-lg font-medium disabled:opacity-30 disabled:cursor-default transition-colors shrink-0"
          >
            {saveProfile.isPending ? 'saving...' : 'save profile'}
          </button>
        </div>
      </div>

      {/* ── Live files: SOUL.md + IDENTITY.md ─────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <button
          onClick={() => setShowRawEditors(!showRawEditors)}
          className="w-full px-4 py-2.5 flex items-center justify-between text-left hover:bg-surface-2/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-text-secondary font-mono">SOUL.md + IDENTITY.md (live from container)</span>
            {(soulDirty || identityDirty) && <span className="text-[9px] text-amber-400 font-mono">unsaved</span>}
          </div>
          <span className="text-text-tertiary text-[10px] font-mono">{showRawEditors ? '[-]' : '[+]'}</span>
        </button>

        {showRawEditors && (
          <div className="border-t border-border divide-y divide-border">
            {/* SOUL.md */}
            <div>
              <div className="px-4 py-2 flex items-center justify-between bg-surface-0/30 border-b border-border/50">
                <span className="text-[10px] font-mono text-text-primary">SOUL.md</span>
                <span className="text-[9px] text-text-tertiary font-mono">/root/clawd/SOUL.md — agent&apos;s main context</span>
                <button
                  onClick={() => saveRawSoul.mutate()}
                  disabled={!soulDirty || saveRawSoul.isPending}
                  className="text-[10px] font-mono px-3 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-30 shrink-0"
                >
                  {saveRawSoul.isPending ? 'saving...' : 'save'}
                </button>
              </div>
              {soulLoading ? (
                <div className="p-4 text-text-tertiary font-mono text-[10px] animate-pulse">reading...</div>
              ) : (
                <textarea
                  value={soulContent}
                  onChange={e => { setSoulContent(e.target.value); setSoulDirty(true); }}
                  className="w-full bg-surface-0/30 p-4 text-[11px] text-text-secondary font-mono leading-relaxed resize-none focus:outline-none"
                  rows={14}
                  spellCheck={false}
                  placeholder="# Soul — agent identity and guidelines..."
                />
              )}
            </div>

            {/* IDENTITY.md */}
            <div>
              <div className="px-4 py-2 flex items-center justify-between bg-surface-0/30 border-b border-border/50">
                <span className="text-[10px] font-mono text-text-primary">IDENTITY.md</span>
                <span className="text-[9px] text-text-tertiary font-mono">/root/clawd/IDENTITY.md — compact reference</span>
                <button
                  onClick={() => saveRawIdentity.mutate()}
                  disabled={!identityDirty || saveRawIdentity.isPending}
                  className="text-[10px] font-mono px-3 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-30 shrink-0"
                >
                  {saveRawIdentity.isPending ? 'saving...' : 'save'}
                </button>
              </div>
              {identityLoading ? (
                <div className="p-4 text-text-tertiary font-mono text-[10px] animate-pulse">reading...</div>
              ) : (
                <textarea
                  value={identityContent}
                  onChange={e => { setIdentityContent(e.target.value); setIdentityDirty(true); }}
                  className="w-full bg-surface-0/30 p-4 text-[11px] text-text-secondary font-mono leading-relaxed resize-none focus:outline-none"
                  rows={8}
                  spellCheck={false}
                  placeholder="# Identity — name, role, goal..."
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Workspace File Explorer ───────────────────────────────────────────────────

function WorkspaceTab({ instanceId, isRunning }: { instanceId: string; isRunning: boolean }) {
  const [currentPath, setCurrentPath] = useState('/root/.openclaw/workspace');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const { data: files, isLoading: filesLoading, error: filesError } = useQuery({
    queryKey: ['files', instanceId, currentPath],
    queryFn: () => listFiles(instanceId, currentPath),
    enabled: isRunning,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: fileContent, isLoading: contentLoading } = useQuery({
    queryKey: ['file-content', instanceId, selectedFile],
    queryFn: () => readFile(instanceId, selectedFile!),
    enabled: !!selectedFile && isRunning,
  });

  if (!isRunning) {
    return (
      <div className="bg-surface-1 border border-border rounded-xl p-12 text-center">
        <pre className="text-text-tertiary font-mono text-lg mb-2">( -_- )</pre>
        <p className="text-text-secondary font-mono text-sm">agent not running</p>
        <p className="text-text-tertiary font-mono text-[10px] mt-1">start the agent to browse its workspace</p>
      </div>
    );
  }

  const entries = files?.entries ?? [];

  function navigateDir(path: string) {
    setCurrentPath(path);
  }

  function getFileExtension(name: string): string {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
  }

  function getFileIcon(entry: FileEntry): string {
    if (entry.type === 'dir') return '>';
    const ext = getFileExtension(entry.name);
    if (['ts', 'tsx', 'js', 'jsx'].includes(ext)) return '*';
    if (['md', 'txt', 'log'].includes(ext)) return '~';
    if (['json', 'yaml', 'yml', 'toml'].includes(ext)) return '#';
    if (['sh', 'bash'].includes(ext)) return '$';
    if (['py', 'rb', 'go', 'rs'].includes(ext)) return '&';
    return '.';
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  }

  const pathParts = currentPath.replace('/root', '').split('/').filter(Boolean);

  return (
    <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-3">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <button onClick={() => { setCurrentPath('/root'); setSelectedFile(null); }}
            className="text-[11px] text-accent hover:text-accent-bright font-mono shrink-0">~</button>
          {pathParts.map((part, i) => (
            <span key={i} className="flex items-center gap-1">
              <span className="text-text-tertiary font-mono text-[11px]">/</span>
              <button
                onClick={() => navigateDir('/root/' + pathParts.slice(0, i + 1).join('/'))}
                className="text-[11px] text-text-secondary hover:text-accent font-mono truncate"
              >{part}</button>
            </span>
          ))}
        </div>
        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border bg-surface-0 accent-accent" />
          <span className="text-[10px] text-text-tertiary font-mono">live</span>
        </label>
      </div>

      <div className="flex" style={{ minHeight: 400 }}>
        {/* File Tree */}
        <div className="w-64 border-r border-border overflow-y-auto shrink-0" style={{ maxHeight: 600 }}>
          {filesLoading ? (
            <div className="p-4 text-center text-text-tertiary font-mono text-[10px] animate-pulse">scanning...</div>
          ) : filesError ? (
            <div className="p-4 text-center text-red-400 font-mono text-[10px]">failed to list files</div>
          ) : entries.length === 0 ? (
            <div className="p-4 text-center text-text-tertiary font-mono text-[10px]">empty workspace</div>
          ) : (
            <div className="py-1">
              {entries.map((entry) => {
                const fullPath = `${currentPath}/${entry.name}`.replace(/\/+/g, '/');
                const isSelected = selectedFile === fullPath;
                return (
                  <button
                    key={entry.name}
                    onClick={() => {
                      if (entry.type === 'dir') {
                        navigateDir(fullPath);
                      } else {
                        setSelectedFile(fullPath);
                      }
                    }}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] font-mono transition-colors group ${
                      isSelected ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface-2/50 hover:text-text-primary'
                    }`}
                  >
                    <span className={`shrink-0 w-3 text-center ${entry.type === 'dir' ? 'text-accent' : 'text-text-tertiary'}`}>
                      {getFileIcon(entry)}
                    </span>
                    <span className="truncate flex-1">{entry.name}{entry.type === 'dir' ? '/' : ''}</span>
                    {entry.type === 'file' && (
                      <span className="text-[9px] text-text-tertiary shrink-0">{formatSize(entry.size)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* File Viewer */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!selectedFile ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center">
                <pre className="text-text-tertiary font-mono text-sm mb-2">{'{ }'}</pre>
                <p className="text-text-tertiary font-mono text-[10px]">select a file to view</p>
              </div>
            </div>
          ) : contentLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-text-tertiary font-mono text-[10px] animate-pulse">reading...</span>
            </div>
          ) : fileContent ? (
            <>
              <div className="px-4 py-2 border-b border-border/50 flex items-center justify-between bg-surface-0/50">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] text-text-primary font-mono truncate">{selectedFile.split('/').pop()}</span>
                  <span className="text-[9px] text-text-tertiary font-mono shrink-0">{formatSize(fileContent.size)}</span>
                  {fileContent.truncated && (
                    <span className="text-[9px] text-amber-400 font-mono shrink-0">truncated</span>
                  )}
                </div>
                <a
                  href={getFileDownloadUrl(instanceId, selectedFile)}
                  download
                  className="text-[10px] text-accent hover:text-accent-bright font-mono px-2 py-1 rounded bg-surface-3/50 hover:bg-surface-3 transition-colors shrink-0"
                >
                  download
                </a>
              </div>
              <pre className="flex-1 overflow-auto p-4 text-[11px] text-text-secondary font-mono leading-relaxed whitespace-pre-wrap break-all bg-surface-0/30"
                style={{ maxHeight: 550 }}>
                {fileContent.content}
              </pre>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-red-400 font-mono text-[10px]">failed to read file</span>
            </div>
          )}
        </div>
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
  const [activeTab, setActiveTab] = useState<'overview' | 'profile' | 'security' | 'workspace'>('overview');

  // Listen for tour tab-switch events
  const handleTourTab = useCallback((e: Event) => {
    const tab = (e as CustomEvent).type.replace('tour:tab:', '') as typeof activeTab;
    if (['overview', 'profile', 'security', 'workspace'].includes(tab)) setActiveTab(tab);
  }, []);
  useEffect(() => {
    const tabs = ['tour:tab:overview', 'tour:tab:profile', 'tour:tab:security', 'tour:tab:workspace'];
    tabs.forEach(t => window.addEventListener(t, handleTourTab));
    return () => tabs.forEach(t => window.removeEventListener(t, handleTourTab));
  }, [handleTourTab]);

  const qc = useQueryClient();
  const dismissMutation = useMutation({
    mutationFn: dismissFlag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });

  const byDay = contributions?.byDay ?? [];
  const dailyCounts = byDay.map((d: any) => d.count);
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter((f: any) => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const trust = mission?.trustScore ?? 50;
  const totalCost = Number(cost?.costToday ?? mission?.estimatedCost ?? 0) || 0;
  const summary = contributions?.summary;
  const totalActions = summary?.totalActions ?? mission?.progress?.total ?? 0;

  // These useMemo hooks MUST be before any early return to avoid React error #310
  const weather = useMemo(() => trustToWeather(trust), [trust]);

  const contributionScore = useMemo(() => {
    if (!summary || summary.totalActions === 0) return 0;
    const efficiency = parseFloat(summary.approvalEfficiency) || 0;
    const denialRate = parseFloat(summary.denialRate) || 0;
    const outputScore = Math.min(100, ((summary.filesCreated ?? 0) * 5 + (summary.filesEdited ?? 0) * 3 + (summary.commandsExecuted ?? 0) * 2 + (summary.linesWritten ?? 0) * 0.1));
    return Math.round(Math.min(100, (efficiency * 0.3 + (100 - denialRate) * 0.2 + outputScore * 0.5)));
  }, [summary]);

  if (isLoading || !instance) {
    return <div className="flex items-center justify-center h-64">
      <span className="text-text-secondary text-sm font-mono animate-pulse">loading...</span>
    </div>;
  }

  return (
    <div className="relative">
      <WeatherBackground weather={weather} />
      <InstanceMiniTour setActiveTab={setActiveTab} />

      <div className="max-w-5xl mx-auto space-y-5 relative z-10">
      <Link to="/" className="text-xs text-text-tertiary hover:text-text-secondary transition-colors font-mono inline-flex items-center gap-1.5">
        <span>←</span> dashboard
      </Link>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-6" data-tour="tour-instance-header">
        <div className="flex items-center gap-6">
          {/* Face — clean, well-padded */}
          <div className="shrink-0 w-20 h-20 rounded-xl bg-surface-0 border border-border/50 flex items-center justify-center">
            <AgentCharacter mission={mission} instance={instance} />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-xl font-bold text-text-primary font-mono truncate">{instance.name}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium font-mono shrink-0 ${
                instance.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-500'
              }`}>{instance.status}</span>
              {(mission?.subAgents?.length ?? 0) > 0 && (
                <span className="text-[10px] font-mono text-text-secondary bg-surface-3 px-2 py-0.5 rounded-full shrink-0">
                  +{mission!.subAgents.length} sub-agent{mission!.subAgents.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {mission?.role && <p className="text-sm text-text-secondary font-mono">{mission.role}</p>}
            {mission?.goal && mission.goal !== instance.name && (
              <p className="text-xs text-text-tertiary font-mono mt-0.5">goal: {mission.goal}</p>
            )}
            {instance.status === 'running' && (
              <p className="text-xs text-amber-400/90 font-mono mt-2">
                Your Anthropic API key is in use while this instance is running. Stop the instance when not in use to avoid API spend.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Tab Bar ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 bg-surface-1 border border-border rounded-xl p-1.5">
        {(['overview', 'profile', 'security', 'workspace'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            data-tour={`tour-tab-${tab}`}
            className={`px-5 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider transition-colors ${
              activeTab === tab
                ? 'bg-accent/10 text-accent font-medium'
                : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-2/50'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'workspace' ? (
        <WorkspaceTab instanceId={instance.id} isRunning={instance.status === 'running'} />
      ) : activeTab === 'profile' ? (
        <ProfileTab instanceId={instance.id} instance={instance} isRunning={instance.status === 'running'} />
      ) : activeTab === 'security' ? (
        <CapabilitiesSection instance={instance} />
      ) : (
      <>
      {/* ── At a Glance ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {/* Trust */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-text-muted uppercase tracking-wider font-mono">Trust</span>
            {dailyCounts.length > 1 && <Sparkline data={dailyCounts} color={trust > 70 ? '#34d399' : trust > 40 ? '#fbbf24' : '#f87171'} width={64} height={20} />}
          </div>
          <div className="flex items-end gap-2">
            <span className={`text-2xl font-bold tabular-nums font-mono ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>
              {trust}
            </span>
            <div className="flex-1 mb-1.5">
              <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-500 ${trust > 70 ? 'bg-emerald-500' : trust > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${trust}%` }} />
              </div>
            </div>
          </div>
        </div>

        {/* Cost */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-mono mb-3">Cost</div>
          <div className="text-2xl font-bold text-text-primary font-mono tabular-nums">${totalCost.toFixed(2)}</div>
          <div className="text-[10px] text-text-tertiary font-mono mt-1">week: ${(cost?.costThisWeek ?? 0).toFixed(2)}</div>
        </div>

        {/* Actions */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] text-text-muted uppercase tracking-wider font-mono">Actions</span>
            {dailyCounts.length > 1 && <Sparkline data={dailyCounts} width={64} height={20} />}
          </div>
          <div className="text-2xl font-bold text-text-primary font-mono tabular-nums">{totalActions}</div>
          {(mission?.progress?.pending ?? 0) > 0 && (
            <div className="text-[10px] text-amber-400 font-mono mt-1">{mission!.progress!.pending} pending</div>
          )}
        </div>

        {/* Score */}
        <div className="bg-surface-1 border border-border rounded-xl p-4">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-mono mb-3">Score</div>
          <div className={`text-2xl font-bold font-mono tabular-nums ${
            contributionScore >= 70 ? 'text-emerald-400' : contributionScore >= 40 ? 'text-amber-400' : 'text-text-tertiary'
          }`}>{contributionScore}</div>
          <div className="text-[10px] text-text-tertiary font-mono mt-1">
            {summary?.approvalEfficiency ? `${summary.approvalEfficiency} eff.` : 'no data'}
          </div>
        </div>
      </div>

      {/* ── Anomaly Alerts ─────────────────────────────────────────────────── */}
      {criticalFlags.length > 0 && (
        <div className="space-y-2">
          {criticalFlags.slice(0, 3).map(flag => (
            <div key={flag.id} className="bg-red-500/5 border border-red-500/20 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <span className="font-mono text-red-400 text-[11px] font-bold shrink-0 mt-0.5">[{flag.severity}]</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-red-300 font-medium">{flag.title}</p>
                  <p className="text-xs text-red-400/70 mt-1 truncate">{flag.description?.split('\n')[0]}</p>
                  <div className="flex items-center gap-4 mt-2.5">
                    <Link to="/audit" className="text-[11px] text-red-300 font-medium hover:text-red-200 font-mono">view audit →</Link>
                    <button onClick={() => dismissMutation.mutate(flag.id)} className="text-[11px] text-red-400/30 hover:text-red-400/70 font-mono">dismiss</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Activity Over Time ─────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">Audit · Last 7 Days</h2>
          {summary && (
            <div className="flex items-center gap-4 text-[11px] text-text-tertiary font-mono">
              <span>denial rate: {summary.denialRate ?? '—'}</span>
              <span>PRs: {summary.prsAndCommits ?? 0}</span>
            </div>
          )}
        </div>
        <ActivityChart
          data={dailyCounts.length > 0 ? dailyCounts : [contributionScore]}
          labels={byDay.length > 0 ? [byDay[0]?.date?.slice(5) ?? '', byDay[byDay.length - 1]?.date?.slice(5) ?? ''] : ['today', 'today']}
        />
      </div>

      {/* ── Output + Categories side by side ──────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Output stats */}
        <div className="bg-surface-1 border border-border rounded-xl p-5">
          <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono mb-4">Output</h3>
          <div className="space-y-3">
            {[
              { label: 'Files Created', value: summary?.filesCreated ?? 0, color: 'text-blue-400' },
              { label: 'Files Edited', value: summary?.filesEdited ?? 0, color: 'text-cyan-400' },
              { label: 'Lines Written', value: summary?.linesWritten ?? 0, color: 'text-emerald-400' },
              { label: 'Commands Run', value: summary?.commandsExecuted ?? 0, color: 'text-amber-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-xs text-text-secondary font-mono">{label}</span>
                <span className={`text-sm font-bold tabular-nums font-mono ${color}`}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Categories */}
        <div className="bg-surface-1 border border-border rounded-xl p-5">
          <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono mb-4">Categories</h3>
          {mission?.categoryBreakdown && Object.keys(mission.categoryBreakdown).length > 0 ? (
            <PieChart breakdown={mission.categoryBreakdown} />
          ) : (
            <div className="text-xs text-text-tertiary font-mono py-4">no data yet</div>
          )}
        </div>
      </div>

      {/* ── Agent Network ─────────────────────────────────────────────────── */}
      <AgentNetwork mission={mission} instances={allInstances ?? []} />

      {/* ── Recent audit ────────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">Recent audit</h3>
          <Link to="/audit" className="text-[11px] text-accent hover:text-accent-bright font-mono">all →</Link>
        </div>
        {!activity?.data?.length ? (
          <div className="p-10 text-center font-mono">
            <div className="text-text-tertiary text-sm" style={{ animation: 'breathe 4s ease-in-out infinite' }}>( o_o ) no actions yet</div>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {activity.data.slice(0, 10).map(item => (
              <div key={item.id} className="px-5 py-3 flex items-center gap-4 text-sm hover:bg-surface-2/30 transition-colors">
                <span className="text-[11px] text-text-tertiary w-14 shrink-0 font-mono tabular-nums">
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="text-text-primary truncate flex-1 text-xs">{item.humanDescription}</span>
                <span className={`text-[11px] font-mono font-medium shrink-0 ${
                  item.status === 'denied' ? 'text-red-400' : item.status === 'pending' ? 'text-amber-400' : 'text-emerald-400'
                }`}>{item.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      </div>
    </div>
  );
}
