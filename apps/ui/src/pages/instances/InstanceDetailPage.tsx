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
  startInstance,
  stopInstance,
  restartInstance,
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
  getMcpServers,
  addMcpServer,
  updateMcpServer,
  deleteMcpServer,
  getInstalledSkills,
  installSkill,
  removeSkill,
  searchClawHub,
  getAgentContainerState,
  isContainerReady,
  type FileEntry,
  type MissionData,
  type Instance,
  type McpServerConfig,
  type CreateMcpServerRequest,
  type InstalledSkill,
  type ClawHubSkill,
  getConnections,
} from '../../api/client.ts';
import { WeatherBackground, trustToWeather } from '../../components/weather/WeatherBackground.tsx';
import { useToast } from '../../components/common/Toast.tsx';
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

function InstanceStatusBadge({ instance }: { instance: Instance }) {
  const state = getAgentContainerState(instance);
  const labels: Record<typeof state, string> = {
    offline: 'offline',
    starting: 'Starting…',
    restarting: 'Restarting…',
    online: 'online',
    stopping: 'Stopping…',
  };
  const colors: Record<typeof state, string> = {
    offline: 'bg-zinc-500/10 text-zinc-500',
    starting: 'bg-amber-500/10 text-amber-400',
    restarting: 'bg-amber-500/10 text-amber-400',
    online: 'bg-emerald-500/10 text-emerald-400',
    stopping: 'bg-amber-500/10 text-amber-400',
  };
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-medium font-mono shrink-0 ${colors[state]}`}>
      {labels[state]}
    </span>
  );
}

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
                  <div className={`flex-1 border rounded-lg p-2.5 transition-colors ${sa.status === 'awaiting_approval' ? 'border-amber-500/25 bg-amber-500/[0.03]' :
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
  tab?: 'overview' | 'profile' | 'tools' | 'workspace';
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
    target: 'tour-tab-tools',
    tab: 'tools',
    title: 'Tools & Credentials',
    content: 'Built-in tools, ClawHub skills, MCP servers, and agent-exposed credentials. The agent is unrestricted — the Gate decides policy.',
  },
  {
    target: 'tour-agent-keys',
    tab: 'tools',
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

function InstanceMiniTour({ setActiveTab }: { setActiveTab: (t: 'overview' | 'profile' | 'tools' | 'workspace') => void }) {
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
          style={{
            left: rect.left, top: rect.top, width: rect.width, height: rect.height,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.6), 0 0 30px 4px rgba(99,102,241,0.15)'
          }} />
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

// ── Tools & Credentials Tab ──────────────────────────────────────────────────
// ── Proxy Overview — SSE URL, config snippets, tool count ─────────────────────

function ProxyOverview({ instance }: { instance: Instance }) {
  const [copied, setCopied] = useState(false);
  const [configTab, setConfigTab] = useState<'claude' | 'cursor' | 'rest'>('claude');

  const { data: mcpServers } = useQuery({
    queryKey: ['mcp-servers', instance.id],
    queryFn: () => getMcpServers(instance.id),
  });

  const sseUrl = instance.endpoint || `http://wooblay-mcp-proxy-${instance.name}:3100/sse`;
  const toolCount = mcpServers?.filter(s => s.enabled).length ?? 0;

  const copyUrl = () => {
    navigator.clipboard.writeText(sseUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const claudeConfig = JSON.stringify({
    mcpServers: {
      wooblay: {
        command: "npx",
        args: ["-y", "@anthropic-ai/mcp-client", sseUrl],
      },
    },
  }, null, 2);

  const cursorConfig = JSON.stringify({
    mcpServers: {
      wooblay: {
        url: sseUrl,
      },
    },
  }, null, 2);

  const restExample = `curl -X POST ${sseUrl.replace('/sse', '/api/tool/execute')} \\
  -H "Content-Type: application/json" \\
  -d '{"action":"mcp:tool-call","toolName":"...","args":{...}}'`;

  const snippets: Record<string, string> = { claude: claudeConfig, cursor: cursorConfig, rest: restExample };

  return (
    <div className="space-y-4">
      {/* SSE Endpoint */}
      <div className="bg-surface-1 border border-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">SSE Endpoint</h3>
          <span className="text-[11px] text-text-muted font-mono">{toolCount} MCP server{toolCount !== 1 ? 's' : ''} configured</span>
        </div>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-surface-0 border border-border rounded-lg px-4 py-3 text-sm font-mono text-text-primary break-all select-all">
            {sseUrl}
          </code>
          <button
            onClick={copyUrl}
            className="shrink-0 px-4 py-3 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-xs font-mono font-medium transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Config snippets */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border">
          {(['claude', 'cursor', 'rest'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setConfigTab(tab)}
              className={`px-5 py-2.5 text-[11px] font-mono uppercase tracking-wider transition-colors ${
                configTab === tab
                  ? 'bg-accent/10 text-accent font-medium border-b-2 border-accent'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              {tab === 'claude' ? 'Claude Desktop' : tab === 'cursor' ? 'Cursor' : 'REST API'}
            </button>
          ))}
        </div>
        <pre className="p-5 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
          {snippets[configTab]}
        </pre>
      </div>

      {/* Quick actions */}
      {toolCount === 0 && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-5 text-center">
          <p className="text-sm text-amber-300 font-medium mb-1">No MCP servers configured yet</p>
          <p className="text-xs text-amber-400/60">Switch to the Tools tab to add MCP servers and vault credentials.</p>
        </div>
      )}
    </div>
  );
}

// Unified view: native tools (always on), MCP servers, agent-exposed credentials.
// NO restrictions, NO toggles on capabilities. The agent has full power.
// The Gate evaluates every action at runtime — that's the security model.

function CapabilitiesSection({ instance }: { instance: Instance }) {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [restartBaseline, setRestartBaseline] = useState<string | null>(null);

  const { data: secretsData, isLoading: secretsLoading } = useQuery({
    queryKey: ['instance-secrets', instance.id],
    queryFn: () => getInstanceSecrets(instance.id),
  });
  const { data: mcpServers } = useQuery({
    queryKey: ['mcp-servers', instance.id],
    queryFn: () => getMcpServers(instance.id),
  });
  const { data: installedSkills } = useQuery({
    queryKey: ['installed-skills', instance.id],
    queryFn: () => getInstalledSkills(instance.id),
  });

  const restartFingerprint = useMemo(() => {
    const secrets = (secretsData?.secrets ?? []).map((s: { key: string }) => s.key).sort();
    const mcp = (mcpServers ?? []).map((s: { id: string; enabled: boolean; connectionIds?: string[] }) =>
      `${s.id}:${s.enabled}:${(s.connectionIds ?? []).length}`,
    ).sort();
    const skills = (installedSkills ?? []).map((s) => s.name).sort();
    return JSON.stringify({ mcp, skills, secrets });
  }, [secretsData, mcpServers, installedSkills]);

  useEffect(() => {
    if (restartBaseline === null && restartFingerprint) {
      setRestartBaseline(restartFingerprint);
    }
  }, [restartBaseline, restartFingerprint]);

  const restartBannerVisible = restartBaseline !== null && restartFingerprint !== restartBaseline;

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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance-secrets', instance.id] });
    },
  });

  const existingKeys = secretsData?.secrets ?? [];

  const isProxy = instance.instanceType === 'proxy';

  return (
    <div className="space-y-4">
      <RestartBanner
        instanceId={instance.id}
        visible={restartBannerVisible}
        onRestarted={() => setRestartBaseline(restartFingerprint)}
      />

      {/* ── Built-in Tools (agent only) ──────────────────────── */}
      {!isProxy && (
        <div className="bg-surface-1 border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">
              Built-in Tools
            </h3>
            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
              unrestricted
            </span>
          </div>
          <p className="text-[10px] text-text-muted mb-4">
            OpenClaw core tools — always available. Every call goes through the Gate for policy evaluation, risk classification, and audit logging. Add more tools via MCP servers below.
          </p>

          <div className="grid grid-cols-3 gap-2">
            {[
              { name: 'exec', desc: 'Shell commands' },
              { name: 'write', desc: 'Create files' },
              { name: 'edit', desc: 'Modify files' },
              { name: 'read', desc: 'Read files' },
              { name: 'search', desc: 'File search' },
              { name: 'web_fetch', desc: 'HTTP requests' },
              { name: 'browser', desc: 'Browser automation' },
            ].map(t => (
              <div key={t.name} className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-surface-2/30 border border-border/30">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                <div className="min-w-0">
                  <code className="text-[10px] text-text-primary font-mono">{t.name}</code>
                  <p className="text-[9px] text-text-muted truncate">{t.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[9px] text-text-muted mt-3 pt-3 border-t border-border/30">
            The agent is unrestricted.{' '}
            <Link to="/policies" className="text-accent hover:underline">Policies</Link>{' '}
            decide what gets EXECUTED, DENIED, or held for APPROVAL — per action, at runtime. Install community skills from ClawHub or add MCP servers below to extend capabilities.
          </p>
        </div>
      )}

      {/* ── ClawHub Skills (agent only) ──────────────────────── */}
      {!isProxy && (
        <ClawHubSkillsSection instanceId={instance.id} containerOnline={isContainerReady(instance)} onConfigChange={() => {}} />
      )}

      {/* ── MCP Tool Servers ────────────────────────────────────── */}
      <McpToolsSection instanceId={instance.id} onConfigChange={() => {}} />

      {/* ── Agent-Exposed Credentials (agent only) ──────────────── */}
      {!isProxy && (
        <div className="bg-surface-1 border border-border rounded-xl p-5" data-tour="tour-agent-keys">
          <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono mb-1">
            Agent-Exposed Credentials
          </h3>
          <p className="text-[10px] text-text-muted mb-4">
            Environment variables injected directly into the agent container.
            The agent can read and use these. For secrets the agent should <em>not</em> see, use{' '}
            <Link to="/credentials" className="text-accent hover:underline">exec-only vault credentials</Link> instead — those are injected only into ephemeral L3 containers.
          </p>

          {secretsLoading ? (
            <div className="text-[10px] text-text-muted font-mono animate-pulse py-3">loading...</div>
          ) : existingKeys.length > 0 ? (
            <div className="space-y-1.5 mb-4">
              {existingKeys.map((s: any) => (
                <div key={s.key} className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-2/50 group">
                  <div className="flex items-center gap-3">
                    <code className="text-[11px] text-text-primary font-mono">{s.key}</code>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border text-amber-400 bg-amber-500/10 border-amber-500/20">
                      agent-visible
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
      )}

      {/* Quick links */}
      <div className="flex gap-3">
        <Link to="/credentials" className="flex-1 bg-surface-1 border border-border rounded-xl p-4 hover:border-border-bright transition-colors group">
          <p className="text-[11px] font-medium text-text-primary">Vault Credentials</p>
          <p className="text-[10px] text-text-muted mt-0.5">Exec-only secrets for L3 containers <span className="opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span></p>
        </Link>
        <Link to="/policies" className="flex-1 bg-surface-1 border border-border rounded-xl p-4 hover:border-border-bright transition-colors group">
          <p className="text-[11px] font-medium text-text-primary">Policies</p>
          <p className="text-[10px] text-text-muted mt-0.5">Runtime rules for allow / deny / approve <span className="opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span></p>
        </Link>
        <Link to="/audit" className="flex-1 bg-surface-1 border border-border rounded-xl p-4 hover:border-border-bright transition-colors group">
          <p className="text-[11px] font-medium text-text-primary">Audit</p>
          <p className="text-[10px] text-text-muted mt-0.5">Every action, every decision <span className="opacity-0 group-hover:opacity-100 transition-opacity">&rarr;</span></p>
        </Link>
      </div>
    </div>
  );
}

// ── ClawHub Skills Section ────────────────────────────────────────────────────

function ClawHubSkillsSection({ instanceId, containerOnline, onConfigChange }: { instanceId: string; containerOnline: boolean; onConfigChange: () => void }) {
  const qc = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Skills list reads from host volume — works even when container is stopped
  const { data: installed, isLoading: installedLoading } = useQuery({
    queryKey: ['installed-skills', instanceId],
    queryFn: () => getInstalledSkills(instanceId),
  });

  const { data: searchResults, isLoading: searchLoading, error: searchError } = useQuery({
    queryKey: ['clawhub-search', searchTerm],
    queryFn: () => searchClawHub(searchTerm),
    enabled: searchTerm.length >= 2,
  });

  const installMut = useMutation({
    mutationFn: (slug: string) => installSkill(instanceId, slug),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installed-skills', instanceId] });
      onConfigChange();
    },
  });

  const removeMut = useMutation({
    mutationFn: (name: string) => removeSkill(instanceId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['installed-skills', instanceId] });
      onConfigChange();
    },
  });

  const handleSearch = () => {
    if (searchQuery.trim().length >= 2) {
      setSearchTerm(searchQuery.trim());
    }
  };

  const installedNames = new Set((installed ?? []).map((s: InstalledSkill) => s.name));
  const results: ClawHubSkill[] = (searchResults as any)?.skills ?? (Array.isArray(searchResults) ? searchResults : []);

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">
          ClawHub Skills
        </h3>
        <div className="flex items-center gap-3">
          <a
            href="https://clawhub.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-mono text-text-muted hover:text-text-secondary transition-colors"
          >
            browse registry
          </a>
          <button
            onClick={() => setShowSearch(!showSearch)}
            disabled={!containerOnline}
            title={!containerOnline ? 'Start the agent to install skills' : undefined}
            className="text-[10px] font-mono text-accent hover:text-accent-bright transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {showSearch ? 'cancel' : containerOnline ? '+ install skill' : '+ install (start agent)'}
          </button>
        </div>
      </div>
      <p className="text-[10px] text-text-muted mb-4">
        Community-developed skills from ClawHub — the public skill registry for OpenClaw.
        Skills extend the agent's capabilities with specialized knowledge and tool integrations.
        Changes take effect on the next session (restart).
      </p>

      {/* Installed skills */}
      {installedLoading ? (
        <div className="text-[10px] text-text-muted font-mono animate-pulse py-3">scanning skills...</div>
      ) : installed && installed.length > 0 ? (
        <div className="space-y-2 mb-4">
          {installed.map((skill: InstalledSkill) => (
            <div key={skill.name} className="bg-surface-2/50 rounded-lg p-3 group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-400 shrink-0" />
                  <code className="text-[11px] text-text-primary font-mono">{skill.name}</code>
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border text-violet-400 bg-violet-500/10 border-violet-500/20">
                    skill
                  </span>
                </div>
                <button
                  onClick={() => removeMut.mutate(skill.name)}
                  disabled={removeMut.isPending}
                  className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity font-mono"
                >
                  remove
                </button>
              </div>
              {skill.description && (
                <p className="text-[10px] text-text-muted mt-1.5 ml-3.5 truncate">{skill.description}</p>
              )}
            </div>
          ))}
        </div>
      ) : !showSearch ? (
        <p className="text-[10px] text-text-muted font-mono py-3 text-center">
          No skills installed. Search ClawHub to add community-developed capabilities.
        </p>
      ) : null}

      {/* Search + install */}
      {showSearch && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-surface-0/50">
          <div className="flex gap-2">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="Search ClawHub... (e.g. postgres, summarize, calendar)"
              className="flex-1 bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
            />
            <button
              onClick={handleSearch}
              disabled={searchQuery.trim().length < 2 || searchLoading}
              className="px-4 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors shrink-0"
            >
              {searchLoading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {searchError && (
            <p className="text-[10px] text-amber-400 font-mono">
              Could not reach ClawHub — check your connection or try again later.
            </p>
          )}

          {results.length > 0 && (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {results.map((skill: ClawHubSkill) => {
                const isInstalled = installedNames.has(skill.slug);
                const isInstalling = installMut.isPending && installMut.variables === skill.slug;
                return (
                  <div key={skill.slug} className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-surface-2/50 hover:bg-surface-2/80 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <code className="text-[11px] text-text-primary font-mono">{skill.slug}</code>
                        {skill.version && (
                          <span className="text-[9px] text-text-muted font-mono">v{skill.version}</span>
                        )}
                        {skill.downloads > 0 && (
                          <span className="text-[9px] text-text-muted font-mono">{skill.downloads} installs</span>
                        )}
                        {skill.stars > 0 && (
                          <span className="text-[9px] text-text-muted font-mono">{skill.stars} stars</span>
                        )}
                      </div>
                      {skill.description && (
                        <p className="text-[10px] text-text-muted mt-0.5 truncate">{skill.description}</p>
                      )}
                      {skill.tags && skill.tags.length > 0 && (
                        <div className="flex gap-1 mt-1">
                          {skill.tags.slice(0, 4).map(tag => (
                            <span key={tag} className="text-[8px] font-mono text-text-muted bg-surface-3 px-1.5 py-0.5 rounded">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => !isInstalled && installMut.mutate(skill.slug)}
                      disabled={isInstalled || isInstalling}
                      className={`shrink-0 ml-3 px-3 py-1.5 rounded text-[10px] font-mono font-medium transition-colors ${
                        isInstalled
                          ? 'bg-emerald-500/10 text-emerald-400 cursor-default'
                          : 'bg-accent text-surface-0 hover:bg-accent/90 disabled:opacity-40'
                      }`}
                    >
                      {isInstalled ? 'installed' : isInstalling ? 'installing...' : 'install'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {searchTerm && !searchLoading && results.length === 0 && !searchError && (
            <p className="text-[10px] text-text-muted font-mono py-2 text-center">
              No skills found for "{searchTerm}". Try a different search term.
            </p>
          )}

          {installMut.isError && (
            <p className="text-[10px] text-red-400 font-mono">
              Install failed: {(installMut.error as any)?.body ?? (installMut.error as Error)?.message ?? 'Unknown error'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── MCP Tools Section ────────────────────────────────────────────────────────

function McpToolsSection({ instanceId, onConfigChange }: { instanceId: string; onConfigChange: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newTransport, setNewTransport] = useState<'stdio' | 'sse'>('stdio');
  const [newSource, setNewSource] = useState('');
  const [selectedConnIds, setSelectedConnIds] = useState<string[]>([]);

  const { data: servers, isLoading } = useQuery({
    queryKey: ['mcp-servers', instanceId],
    queryFn: () => getMcpServers(instanceId),
  });

  // Fetch available connections for the credential dropdown
  const { data: connections } = useQuery({
    queryKey: ['connections'],
    queryFn: () => getConnections(),
  });
  const activeConns = (connections ?? []).filter((c: any) => c.status === 'active');

  const addMut = useMutation({
    mutationFn: (config: CreateMcpServerRequest) => addMcpServer(instanceId, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', instanceId] });
      setNewName('');
      setNewSource('');
      setSelectedConnIds([]);
      setShowAdd(false);
      onConfigChange();
    },
  });

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [editingCredsServerId, setEditingCredsServerId] = useState<string | null>(null);
  const [editingCredsIds, setEditingCredsIds] = useState<string[]>([]);

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateMcpServer(instanceId, id, { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', instanceId] });
      onConfigChange();
    },
    onError: (err: Error) => {
      toast(`Failed to toggle: ${err.message}`, 'error');
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteMcpServer(instanceId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', instanceId] });
      setDeleteConfirmId(null);
      onConfigChange();
    },
    onError: (err: Error) => {
      toast(`Failed to remove: ${err.message}`, 'error');
    },
  });

  const updateCredsMut = useMutation({
    mutationFn: ({ serverId, connectionIds }: { serverId: string; connectionIds: string[] }) =>
      updateMcpServer(instanceId, serverId, { connectionIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', instanceId] });
      setEditingCredsServerId(null);
      onConfigChange();
    },
    onError: (err: Error) => {
      toast(`Failed to update credentials: ${err.message}`, 'error');
    },
  });

  const startEditingCreds = (server: McpServerConfig) => {
    setEditingCredsServerId(server.id);
    setEditingCredsIds([...(server.connectionIds || [])]);
  };

  const toggleConn = (connId: string) => {
    setSelectedConnIds(prev =>
      prev.includes(connId) ? prev.filter(id => id !== connId) : [...prev, connId]
    );
  };

  const toggleEditingConn = (connId: string) => {
    setEditingCredsIds(prev =>
      prev.includes(connId) ? prev.filter(id => id !== connId) : [...prev, connId]
    );
  };

  const handleSubmit = () => {
    if (!newName.trim() || !newSource.trim()) return;
    addMut.mutate({
      name: newName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      transport: newTransport,
      source: newSource.trim(),
      connectionIds: selectedConnIds.length > 0 ? selectedConnIds : undefined,
    });
  };

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider font-mono">
          MCP Tool Servers
        </h3>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-[10px] font-mono text-accent hover:text-accent-bright transition-colors"
        >
          {showAdd ? 'cancel' : '+ add server'}
        </button>
      </div>
      <p className="text-[10px] text-text-muted mb-4">
        Upstream MCP servers whose tools your agent can use. Link vault connections to enable L3 isolation — credentials are resolved at execution time, never stored here or exposed to the agent. You can link or change credentials for any server anytime via <strong>edit credentials</strong>.
      </p>

      {/* Security callout */}
      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3 mb-4">
        <p className="text-[11px] text-emerald-400 font-medium mb-1">
          Layer 3 Secure Execution
        </p>
        <p className="text-[10px] text-emerald-400/70">
          Tools linked to vault connections run in ephemeral containers. Credentials are resolved from the vault at execution time, injected into a one-shot container, the tool executes, the result is captured, and the container is destroyed. Zero credential exposure to the agent or proxy.
        </p>
      </div>

      {/* Existing servers */}
      {isLoading ? (
        <div className="text-[10px] text-text-muted font-mono animate-pulse py-3">loading...</div>
      ) : servers && servers.length > 0 ? (
        <div className="space-y-2 mb-4">
          {servers.map((s: McpServerConfig) => (
            <div key={s.id} className="bg-surface-2/50 rounded-lg p-3 group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleMut.mutate({ id: s.id, enabled: !s.enabled })}
                    disabled={toggleMut.isPending}
                    className={`w-7 h-4 rounded-full transition-colors relative ${
                      s.enabled ? 'bg-emerald-500' : 'bg-surface-3'
                    } ${toggleMut.isPending ? 'opacity-50' : ''}`}
                  >
                    <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      s.enabled ? 'left-3.5' : 'left-0.5'
                    }`} />
                  </button>
                  <code className="text-[11px] text-text-primary font-mono">{s.name}</code>
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    s.transport === 'stdio'
                      ? 'text-blue-400 bg-blue-500/10 border-blue-500/20'
                      : 'text-purple-400 bg-purple-500/10 border-purple-500/20'
                  }`}>
                    {s.transport}
                  </span>
                  {s.connectionIds.length > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
                      L3 secure
                    </span>
                  )}
                </div>
                {deleteConfirmId === s.id ? (
                  <span className="flex items-center gap-1.5">
                    <button
                      onClick={() => delMut.mutate(s.id)}
                      disabled={delMut.isPending}
                      className="text-[10px] text-red-400 font-mono font-medium"
                    >
                      {delMut.isPending ? 'removing...' : 'confirm'}
                    </button>
                    <button
                      onClick={() => setDeleteConfirmId(null)}
                      className="text-[10px] text-text-muted font-mono"
                    >
                      cancel
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(s.id)}
                    className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100 transition-opacity font-mono"
                  >
                    remove
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                <span className="text-[10px] text-text-muted font-mono truncate">{s.source}</span>
                {s.connections && s.connections.map((c: any) => (
                  <span key={c.id} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-3 text-text-secondary">
                    {c.provider}: {c.name}
                  </span>
                ))}
                {editingCredsServerId !== s.id && (
                  <button
                    type="button"
                    onClick={() => startEditingCreds(s)}
                    className="text-[9px] font-mono text-accent hover:text-accent-bright transition-colors"
                  >
                    edit credentials
                  </button>
                )}
              </div>
              {editingCredsServerId === s.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <p className="text-[9px] text-text-muted">Link vault connections for L3 secure execution. Add or remove anytime.</p>
                  {activeConns.length > 0 ? (
                    <div className="space-y-1">
                      {activeConns.map((c: any) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleEditingConn(c.id)}
                          className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-[10px] font-mono transition-colors ${
                            editingCredsIds.includes(c.id)
                              ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                              : 'bg-surface-2 border border-transparent text-text-secondary hover:bg-surface-3'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                            editingCredsIds.includes(c.id) ? 'border-emerald-500 bg-emerald-500' : 'border-border'
                          }`}>
                            {editingCredsIds.includes(c.id) && <span className="text-white text-[8px]">{'\u2713'}</span>}
                          </span>
                          <span className="text-text-primary">{c.name}</span>
                          <span className="text-text-muted">{c.provider}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[9px] text-text-muted">No active connections. <Link to="/credentials" className="text-accent hover:underline">Add one on Credentials</Link> first.</p>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setEditingCredsServerId(null)}
                      className="px-3 py-1.5 text-[10px] font-mono text-text-secondary hover:text-text-primary"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => updateCredsMut.mutate({ serverId: s.id, connectionIds: editingCredsIds })}
                      disabled={updateCredsMut.isPending}
                      className="px-4 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40"
                    >
                      {updateCredsMut.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : !showAdd ? (
        <p className="text-[10px] text-text-muted font-mono py-3 text-center">
          No MCP servers configured. Add one to extend your agent's tool capabilities.
        </p>
      ) : null}

      {/* Add server form */}
      {showAdd && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-surface-0/50">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Name</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="github-tools"
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
              />
            </div>
            <div className="w-24">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Transport</label>
              <select
                value={newTransport}
                onChange={(e) => setNewTransport(e.target.value as 'stdio' | 'sse')}
                className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary outline-none"
              >
                <option value="stdio">stdio</option>
                <option value="sse">SSE</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">
              {newTransport === 'stdio' ? 'Package / Command' : 'SSE URL'}
            </label>
            <input
              value={newSource}
              onChange={(e) => setNewSource(e.target.value)}
              placeholder={newTransport === 'stdio' ? 'npx @modelcontextprotocol/server-github' : 'https://mcp.example.com/sse'}
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
            />
          </div>

          {/* Connection selection — vault-backed credentials */}
          <div>
            <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">
              Vault Connections <span className="normal-case text-text-muted">(optional — enables L3 isolation)</span>
            </label>
            <p className="text-[9px] text-text-muted mb-2">
              Selected connections' credentials are injected into an ephemeral container at execution time. They never touch the proxy or agent.
            </p>
            {activeConns.length > 0 ? (
              <div className="space-y-1">
                {activeConns.map((c: any) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => toggleConn(c.id)}
                    className={`flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-[10px] font-mono transition-colors ${
                      selectedConnIds.includes(c.id)
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
                        : 'bg-surface-2 border border-transparent text-text-secondary hover:bg-surface-3'
                    }`}
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
                      selectedConnIds.includes(c.id)
                        ? 'border-emerald-500 bg-emerald-500'
                        : 'border-border'
                    }`}>
                      {selectedConnIds.includes(c.id) && (
                        <span className="text-white text-[8px]">{'\u2713'}</span>
                      )}
                    </span>
                    <span className="text-text-primary">{c.name}</span>
                    <span className="text-text-muted">{c.provider}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[9px] text-text-muted py-2">
                No active connections. <Link to="/credentials" className="text-accent hover:underline">Add one on Credentials</Link> first.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowAdd(false); setSelectedConnIds([]); }}
              className="px-3 py-1.5 text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors">
              Cancel
            </button>
            <button onClick={handleSubmit}
              disabled={!newName.trim() || !newSource.trim() || addMut.isPending}
              className="px-4 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">
              {addMut.isPending ? 'Adding...' : 'Add Server'}
            </button>
          </div>

          {addMut.isError && (
            <p className="text-[10px] text-red-400 font-mono">
              Failed: {(addMut.error as any)?.body ?? (addMut.error as Error)?.message ?? 'Unknown error'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Restart Banner ───────────────────────────────────────────────────────────

function RestartBanner({
  instanceId,
  visible,
  onRestarted,
}: {
  instanceId: string;
  visible: boolean;
  onRestarted: () => void;
}) {
  const qc = useQueryClient();
  const restartMut = useMutation({
    mutationFn: () => restartInstance(instanceId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance', instanceId] });
      qc.invalidateQueries({ queryKey: ['instances'] });
      onRestarted();
    },
  });

  if (!visible) return null;

  return (
    <div className="bg-amber-500/8 border border-amber-500/25 rounded-xl px-5 py-3 flex items-center justify-between gap-4 animate-fade-in">
      <div>
        <p className="text-[11px] text-amber-400 font-medium">Configuration changed</p>
        <p className="text-[10px] text-amber-400/70">
          Skill, MCP server, or environment changes require a restart to take effect. Memory and session state are preserved.
        </p>
      </div>
      <button
        onClick={() => restartMut.mutate()}
        disabled={restartMut.isPending}
        className="shrink-0 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-mono font-bold disabled:opacity-50 transition-colors"
      >
        {restartMut.isPending ? 'Restarting\u2026' : 'Restart to apply'}
      </button>
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

        // Restart so the agent picks up the new role/goal (SOUL is read at startup)
        await restartInstance(instanceId);
      }
    },
    onSuccess: () => {
      setStructDirty(false);
      setSoulDirty(false);
      setIdentityDirty(false);
      setSaveStatus('Profile saved — agent restarting to apply new role/goal');
      qc.invalidateQueries({ queryKey: ['instance', instanceId] });
      qc.invalidateQueries({ queryKey: ['instances'] });
      qc.invalidateQueries({ queryKey: ['file-content', instanceId, '/root/clawd/SOUL.md'] });
      qc.invalidateQueries({ queryKey: ['file-content', instanceId, '/root/clawd/IDENTITY.md'] });
      setTimeout(() => setSaveStatus(null), 4000);
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

function WorkspaceTab({ instanceId, instance }: { instanceId: string; instance: Instance }) {
  const [currentPath, setCurrentPath] = useState('/root/.openclaw/workspace');
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);

  const isRunning = instance.status === 'running';
  const containerReady = isContainerReady(instance);

  const { data: files, isLoading: filesLoading, error: filesError } = useQuery({
    queryKey: ['files', instanceId, currentPath],
    queryFn: () => listFiles(instanceId, currentPath),
    enabled: containerReady,
    refetchInterval: autoRefresh ? 5000 : false,
  });

  const { data: fileContent, isLoading: contentLoading } = useQuery({
    queryKey: ['file-content', instanceId, selectedFile],
    queryFn: () => readFile(instanceId, selectedFile!),
    enabled: !!selectedFile && containerReady,
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

  if (!containerReady) {
    return (
      <div className="bg-surface-1 border border-border rounded-xl p-12 text-center">
        <pre className="text-text-tertiary font-mono text-lg mb-2">( . . )</pre>
        <p className="text-text-secondary font-mono text-sm">Agent is starting</p>
        <p className="text-text-tertiary font-mono text-[10px] mt-1">Workspace will be available when the container is up</p>
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
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-[11px] font-mono transition-colors group ${isSelected ? 'bg-accent/10 text-accent' : 'text-text-secondary hover:bg-surface-2/50 hover:text-text-primary'
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
    enabled: !!id, refetchInterval: 3_000,
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
  const [activeTab, setActiveTab] = useState<'overview' | 'profile' | 'tools' | 'workspace'>('overview');

  // Listen for tour tab-switch events
  const handleTourTab = useCallback((e: Event) => {
    const tab = (e as CustomEvent).type.replace('tour:tab:', '') as typeof activeTab;
    if (['overview', 'profile', 'tools', 'workspace'].includes(tab)) setActiveTab(tab);
  }, []);
  useEffect(() => {
    const tabs = ['tour:tab:overview', 'tour:tab:profile', 'tour:tab:tools', 'tour:tab:workspace'];
    tabs.forEach(t => window.addEventListener(t, handleTourTab));
    return () => tabs.forEach(t => window.removeEventListener(t, handleTourTab));
  }, [handleTourTab]);

  const qc = useQueryClient();
  const dismissMutation = useMutation({
    mutationFn: dismissFlag,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flags'] }),
  });

  // ── Lifecycle controls ─────────────────────────────────────────────────
  const lifecycleOpts = {
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instance', id] });
      qc.invalidateQueries({ queryKey: ['instances'] });
    },
  };
  const startMut = useMutation({ mutationFn: () => startInstance(id!), ...lifecycleOpts });
  const stopMut = useMutation({ mutationFn: () => stopInstance(id!), ...lifecycleOpts });
  const restartHeaderMut = useMutation({ mutationFn: () => restartInstance(id!), ...lifecycleOpts });
  const anyLifecycleLoading = startMut.isPending || stopMut.isPending || restartHeaderMut.isPending;
  const containerState = instance ? getAgentContainerState(instance, {
    startPending: startMut.isPending,
    stopPending: stopMut.isPending,
  }) : 'offline';

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
            {instance.instanceType !== 'proxy' && (
              <div className="shrink-0 w-20 h-20 rounded-xl bg-surface-0 border border-border/50 flex items-center justify-center">
                <AgentCharacter mission={mission} instance={instance} />
              </div>
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-bold text-text-primary font-mono truncate">{instance.name}</h1>
                <InstanceStatusBadge instance={instance} />
                <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0 ${
                  instance.instanceType === 'proxy'
                    ? 'bg-violet-500/10 text-violet-400'
                    : 'text-text-muted bg-surface-2'
                }`}>
                  {instance.instanceType === 'proxy' ? 'MCP Proxy' : instance.agentRuntime}
                </span>
                {instance.instanceType !== 'proxy' && (mission?.subAgents?.length ?? 0) > 0 && (
                  <span className="text-[10px] font-mono text-text-secondary bg-surface-3 px-2 py-0.5 rounded-full shrink-0">
                    +{mission!.subAgents.length} sub-agent{mission!.subAgents.length !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              {instance.instanceType === 'proxy' ? (
                <p className="text-xs text-text-tertiary font-mono mt-1">Secure MCP firewall for external agents</p>
              ) : (
                <>
                  {mission?.role && <p className="text-sm text-text-secondary font-mono">{mission.role}</p>}
                  {mission?.goal && mission.goal !== instance.name && (
                    <p className="text-xs text-text-tertiary font-mono mt-0.5">goal: {mission.goal}</p>
                  )}
                  {isContainerReady(instance) && (
                    <p className="text-xs text-amber-400/90 font-mono mt-2">
                      API key active — stop when not in use to avoid spend. Memory is preserved.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Lifecycle controls */}
            <div className="shrink-0 flex flex-col gap-2">
              {containerState === 'offline' ? (
                <button
                  onClick={() => startMut.mutate()}
                  disabled={anyLifecycleLoading}
                  className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-[12px] font-mono font-bold disabled:opacity-40 transition-colors"
                >
                  {startMut.isPending ? 'Starting\u2026' : 'Start'}
                </button>
              ) : (
                <>
                  <button
                    onClick={() => restartHeaderMut.mutate()}
                    disabled={anyLifecycleLoading}
                    className="px-5 py-2 rounded-lg bg-accent/15 hover:bg-accent/25 text-accent text-[11px] font-mono font-medium disabled:opacity-40 transition-colors"
                  >
                    {restartHeaderMut.isPending ? 'Restarting\u2026' : 'Restart'}
                  </button>
                  <button
                    onClick={() => stopMut.mutate()}
                    disabled={anyLifecycleLoading}
                    className="px-5 py-2 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-[11px] font-mono font-medium disabled:opacity-40 transition-colors"
                  >
                    {stopMut.isPending ? 'Stopping\u2026' : 'Stop'}
                  </button>
                </>
              )}
              {instance.liveStatus && (
                <span className="text-[9px] font-mono text-text-muted text-center">{instance.liveStatus}</span>
              )}
            </div>
          </div>
        </div>

        {/* ── Tab Bar ───────────────────────────────────────────────────────── */}
        <div className="flex gap-1 bg-surface-1 border border-border rounded-xl p-1.5">
          {(instance.instanceType === 'proxy'
            ? (['overview', 'tools'] as const)
            : (['overview', 'profile', 'tools', 'workspace'] as const)
          ).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              data-tour={`tour-tab-${tab}`}
              className={`px-5 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider transition-colors ${activeTab === tab
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-2/50'
                }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {activeTab === 'workspace' && instance.instanceType !== 'proxy' ? (
          <WorkspaceTab instanceId={instance.id} instance={instance} />
        ) : activeTab === 'profile' && instance.instanceType !== 'proxy' ? (
          <ProfileTab instanceId={instance.id} instance={instance} isRunning={isContainerReady(instance)} />
        ) : activeTab === 'tools' ? (
          <CapabilitiesSection instance={instance} />
        ) : instance.instanceType === 'proxy' ? (
          <ProxyOverview instance={instance} />
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
                <div className={`text-2xl font-bold font-mono tabular-nums ${contributionScore >= 70 ? 'text-emerald-400' : contributionScore >= 40 ? 'text-amber-400' : 'text-text-tertiary'
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
                      <span className={`text-[11px] font-mono font-medium shrink-0 ${item.status === 'denied' ? 'text-red-400' : item.status === 'pending' ? 'text-amber-400' : 'text-emerald-400'
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
