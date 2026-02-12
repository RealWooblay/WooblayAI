/**
 * Dashboard — The Nerve Center
 *
 * Agents feel ALIVE. Weather reflects performance.
 * Rain when struggling, sunshine when thriving.
 * Faces blink, breathe, react. Minimal but full of character.
 */

import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getStats,
  getInstances,
  getApprovals,
  getMission,
  getFlags,
  type Instance,
  type MissionData,
} from '../../api/client.ts';
import { Button } from '../../components/common/Button.tsx';

// ── Weather System ────────────────────────────────────────────────────────────
// Background animation based on agent health: sunny → cloudy → rain → storm

type Weather = 'sunny' | 'cloudy' | 'rain' | 'storm';

function getWeather(missions: MissionData[]): Weather {
  if (missions.length === 0) return 'cloudy';
  const avgTrust = missions.reduce((s, m) => s + m.trustScore, 0) / missions.length;
  const totalDenied = missions.reduce((s, m) => s + m.progress.denied, 0);
  const hasCritical = missions.some(m => m.blockedActions > 2);
  if (hasCritical || totalDenied > 5) return 'storm';
  if (totalDenied > 0 || missions.some(m => m.blockedActions > 0)) return 'rain';
  if (avgTrust > 60) return 'sunny';
  return 'cloudy';
}

const RAIN_CHARS = '·.:|/';

function WeatherBackground({ weather }: { weather: Weather }) {
  const drops = useMemo(() => {
    if (weather !== 'rain' && weather !== 'storm') return [];
    const count = weather === 'storm' ? 35 : 20;
    return Array.from({ length: count }, (_, i) => ({
      left: (i / count) * 100 + (Math.random() * 4 - 2),
      char: RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)],
      duration: 2 + Math.random() * 3,
      delay: Math.random() * -5,
      size: weather === 'storm' ? 12 : 10,
    }));
  }, [weather]);

  const particles = useMemo(() => {
    if (weather !== 'sunny') return [];
    return Array.from({ length: 12 }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      duration: 4 + Math.random() * 6,
      delay: Math.random() * -8,
    }));
  }, [weather]);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
      {/* Base gradient */}
      {weather === 'sunny' && (
        <div className="absolute inset-0 bg-gradient-to-b from-amber-500/[0.02] via-transparent to-transparent" />
      )}
      {weather === 'rain' && (
        <div className="absolute inset-0 bg-gradient-to-b from-blue-500/[0.03] via-transparent to-transparent" />
      )}
      {weather === 'storm' && (
        <div className="absolute inset-0 bg-gradient-to-b from-red-500/[0.04] via-transparent to-transparent animate-pulse" style={{ animationDuration: '4s' }} />
      )}

      {/* Rain drops */}
      {drops.map((d, i) => (
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

      {/* Sunny particles */}
      {particles.map((p, i) => (
        <span
          key={i}
          className="absolute text-amber-400/10 font-mono text-[8px]"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animation: `breathe ${p.duration}s ease-in-out ${p.delay}s infinite`,
          }}
        >
          ·
        </span>
      ))}

      {/* Scanline */}
      <div className="scanline-overlay" />
    </div>
  );
}

// ── Alive Agent Face ──────────────────────────────────────────────────────────
// Real blinking, breathing, emotional state

function AgentFace({ mission, instance }: { mission?: MissionData; instance: Instance }) {
  const [blink, setBlink] = useState(false);

  // Random blinking every 2-5 seconds
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
      <div className="font-mono text-center animate-breathe" style={{ animationDuration: '6s' }}>
        <span className="text-zinc-600 text-base">( -_- ) zzz</span>
      </div>
    );
  }
  if (!mission) {
    return (
      <div className="font-mono text-center">
        <span className="text-zinc-500 text-base animate-pulse">( . . )</span>
      </div>
    );
  }

  const hasDenied = mission.progress.denied > 2;
  const hasPending = mission.blockedActions > 0 || mission.progress.pending > 0;
  const isWorking = mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';

  const eye = blink ? '-' : 'o';
  const eyeW = blink ? '-' : '•';

  if (hasDenied) {
    return (
      <div className="font-mono text-center">
        <span className="text-red-400 text-base" style={{ animation: 'breathe 1.5s ease-in-out infinite' }}>
          ( x_x )
        </span>
      </div>
    );
  }
  if (hasPending) {
    return (
      <div className="font-mono text-center">
        <span className="text-amber-400 text-base animate-breathe">
          ( {blink ? '-' : '.'}_. )
        </span>
      </div>
    );
  }
  if (isWorking) {
    return (
      <div className="font-mono text-center">
        <span className="text-emerald-400 text-base" style={{ animation: 'breathe 2s ease-in-out infinite' }}>
          ( {eyeW}_{eyeW})&gt;
        </span>
      </div>
    );
  }

  return (
    <div className="font-mono text-center" style={{ animation: 'breathe 4s ease-in-out infinite' }}>
      <span className="text-text-secondary text-base">
        ( {eye}_{eye} )
      </span>
    </div>
  );
}

function AgentStatus({ mission, instance }: { mission?: MissionData; instance: Instance }) {
  if (instance.status !== 'running') {
    return <span className="text-[10px] text-zinc-500 font-mono">offline</span>;
  }
  if (!mission) return <span className="text-[10px] text-zinc-500 font-mono animate-pulse">connecting...</span>;

  const hasDenied = mission.progress.denied > 2;
  const hasPending = mission.blockedActions > 0 || mission.progress.pending > 0;
  const isWorking = mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';

  if (hasDenied) return <span className="text-[10px] text-red-400 font-mono">{mission.progress.denied} actions denied</span>;
  if (hasPending) return <span className="text-[10px] text-amber-400 font-mono animate-pulse">waiting for you...</span>;
  if (isWorking) return <span className="text-[10px] text-emerald-400 font-mono truncate max-w-[250px]">{mission.currentStep}</span>;
  return <span className="text-[10px] text-text-tertiary font-mono">standing by <span className="animate-blink">_</span></span>;
}

// ── Instance Card ────────────────────────────────────────────────────────────

function InstanceCard({ instance }: { instance: Instance }) {
  const isRunning = instance.status === 'running';

  const { data: mission } = useQuery({
    queryKey: ['mission', instance.id],
    queryFn: () => getMission(instance.id),
    refetchInterval: 5_000,
    enabled: isRunning,
  });

  const effectiveRole = mission?.role ?? instance.role ?? instance.inferredRole ?? null;
  const trust = mission?.trustScore ?? 0;
  const cost = mission?.estimatedCost ?? 0;
  const actions = mission?.progress.total ?? 0;

  return (
    <Link
      to={`/instances/${instance.id}`}
      className={
        'block rounded-xl border p-5 transition-all hover:border-accent/30 group ' +
        (mission?.blockedActions
          ? 'border-amber-500/25 bg-surface-1'
          : 'border-border bg-surface-1 hover:bg-surface-1/80')
      }
    >
      <div className="flex items-start gap-4 mb-3">
        <div className="shrink-0 pt-0.5">
          <AgentFace mission={mission} instance={instance} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">{instance.name}</h3>
            <span className="text-[9px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">details →</span>
          </div>
          {effectiveRole && (
            <p className="text-[10px] text-text-secondary truncate mt-0.5">{effectiveRole}</p>
          )}
          <div className="mt-1.5">
            <AgentStatus mission={mission} instance={instance} />
          </div>
        </div>
      </div>

      {/* Metrics */}
      {mission && (
        <div className="flex items-center gap-4 pt-3 border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-tertiary">Trust</span>
            <div className="w-14 h-1.5 rounded-full bg-surface-3 overflow-hidden">
              <div className={`h-full rounded-full transition-all ${trust > 70 ? 'bg-emerald-500' : trust > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                style={{ width: `${trust}%` }} />
            </div>
            <span className={`text-[10px] font-bold tabular-nums ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>
              {trust}
            </span>
          </div>

          <span className="text-[10px] text-text-secondary font-mono tabular-nums">${cost.toFixed(2)}</span>
          <span className="text-[10px] text-text-secondary tabular-nums">{actions} actions</span>

          {(mission.progress.pending ?? 0) > 0 && (
            <span className="ml-auto text-[10px] text-amber-400 font-medium animate-pulse">{mission.progress.pending} pending</span>
          )}
        </div>
      )}
    </Link>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export function CommandCenter() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 5_000 });
  const { data: instances, isLoading: loadingInstances } = useQuery({ queryKey: ['instances'], queryFn: getInstances, refetchInterval: 5_000 });
  const { data: approvals } = useQuery({ queryKey: ['approvals', 'pending'], queryFn: getApprovals, refetchInterval: 5_000 });
  const { data: flagsData } = useQuery({ queryKey: ['flags', 'dashboard'], queryFn: () => getFlags({ dismissed: 'false', limit: '5' }), refetchInterval: 10_000 });

  // Collect missions for weather calculation
  const allInstances = instances ?? [];
  const running = allInstances.filter(i => i.status === 'running');
  const stopped = allInstances.filter(i => i.status !== 'running');
  const pending = approvals ?? [];
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const isEmpty = !loadingInstances && allInstances.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  // Fetch missions for all running instances to compute weather
  const missionQueries = running.map(inst =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({ queryKey: ['mission', inst.id], queryFn: () => getMission(inst.id), refetchInterval: 5_000, enabled: true }),
  );
  const missions = missionQueries.map(q => q.data).filter(Boolean) as MissionData[];
  const weather = getWeather(missions);

  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg relative">
      <WeatherBackground weather={weather} />
      <div className="max-w-4xl mx-auto space-y-5 relative z-10">

        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-primary font-mono">
              {isEmpty && !hasData ? '> wooblay' : running.length > 0 ? `> ${running.length} agent${running.length !== 1 ? 's' : ''} active` : '> dashboard'}
            </h1>
            {hasData && (
              <p className="text-xs text-text-secondary mt-1 font-mono">
                {stats!.totalToolCalls} actions tracked · {stats!.pendingApprovals} awaiting review
              </p>
            )}
          </div>
          {hasData && stats?.byDecision && (
            <div className="flex gap-4 text-[10px] text-text-tertiary font-mono">
              <span>allowed: {stats.byDecision['ALLOW'] ?? 0}</span>
              <span>reviewed: {stats.byDecision['APPROVE'] ?? 0}</span>
              <span className={`${(stats.byDecision['DENY'] ?? 0) > 0 ? 'text-red-400' : ''}`}>denied: {stats.byDecision['DENY'] ?? 0}</span>
            </div>
          )}
        </div>

        {/* Critical Flags Alert */}
        {criticalFlags.length > 0 && (
          <Link to="/activity" className="block p-3 rounded-xl bg-red-500/8 border border-red-500/20 hover:border-red-500/30 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-mono text-red-400 text-xs font-bold">[!]</span>
              <span className="text-xs text-red-300">{criticalFlags.length} anomal{criticalFlags.length !== 1 ? 'ies' : 'y'} detected — review recommended</span>
              <span className="text-[10px] text-red-400/60 ml-auto font-mono">view details →</span>
            </div>
          </Link>
        )}

        {/* Pending Approvals */}
        {pending.length > 0 && (
          <Link to="/approvals" className="block p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 hover:border-amber-500/40 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-mono text-amber-400 text-xs animate-blink">[?]</span>
              <span className="text-xs text-amber-300 font-medium">{pending.length} action{pending.length !== 1 ? 's' : ''} waiting for your approval</span>
              <span className="text-[10px] text-amber-400/60 ml-auto font-mono">review →</span>
            </div>
          </Link>
        )}

        {/* Empty State */}
        {isEmpty && !hasData && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="font-mono text-text-tertiary text-xs leading-relaxed mb-6">
              <div className="border border-border rounded-xl p-6 inline-block">
                <div className="text-2xl mb-2" style={{ animation: 'breathe 4s ease-in-out infinite' }}>( o_o )</div>
                <div className="text-text-secondary">hi there</div>
                <div className="text-text-tertiary mt-1">no agents running</div>
                <div className="text-text-tertiary">deploy one to start</div>
              </div>
            </div>
            <Link to="/instances">
              <Button>Deploy Your First Agent</Button>
            </Link>
          </div>
        )}

        {/* Instance Cards */}
        {running.length > 0 && (
          <div className={`grid gap-3 ${running.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {running.map(inst => (
              <InstanceCard key={inst.id} instance={inst} />
            ))}
          </div>
        )}

        {/* Stopped Instances */}
        {stopped.length > 0 && (
          <div>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">offline</p>
            <div className="grid gap-2 md:grid-cols-3">
              {stopped.map(inst => (
                <Link key={inst.id} to={`/instances/${inst.id}`}
                  className="rounded-lg border border-border bg-surface-0 p-3 opacity-50 hover:opacity-80 transition-all">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-600" style={{ animation: 'breathe 6s ease-in-out infinite' }}>( -_- )</span>
                    <span className="text-xs text-text-tertiary truncate flex-1">{inst.name}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Quick Nav */}
        {hasData && running.length > 0 && (
          <div className="pt-3 border-t border-border/30 flex items-center gap-6">
            <Link to="/activity" className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono transition-colors">activity →</Link>
            <Link to="/policies" className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono transition-colors">policies →</Link>
            <Link to="/audit" className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono transition-colors">audit →</Link>
          </div>
        )}
      </div>
    </div>
  );
}
