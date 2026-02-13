/**
 * Dashboard — The Nerve Center
 *
 * Agents feel ALIVE. Weather reflects average trust.
 * Rain when struggling, sunshine when thriving.
 * Faces blink, breathe, react. Minimal but full of character.
 */

import { useMemo, useState, useEffect } from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
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
import { WeatherBackground, trustToWeather } from '../../components/weather/WeatherBackground.tsx';

// ── Alive Agent Face ──────────────────────────────────────────────────────────

function AgentFace({ mission, instance }: { mission?: MissionData; instance: Instance }) {
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

  const trust = mission.trustScore ?? 50;
  const hasPending = (mission.blockedActions ?? 0) > 0 || (mission.progress?.pending ?? 0) > 0;
  const isWorking = mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';

  let face: string;
  let color: string;
  let speed = '4s';

  if (hasPending) {
    face = `( ${blink ? '-' : '?'}_${blink ? '-' : '?'} )`;
    color = 'text-amber-400';
    speed = '2.5s';
  } else if (trust <= 20) {
    face = `( ${blink ? '-' : 'x'}_${blink ? '-' : 'x'} )`;
    color = 'text-red-400';
    speed = '1.5s';
  } else if (trust <= 40) {
    face = `( ${blink ? '-' : '.'}_.${blink ? '' : ' '})`;
    color = 'text-orange-400';
    speed = '2s';
  } else if (trust <= 60) {
    face = isWorking ? `( ${blink ? '-' : 'o'}_${blink ? '-' : 'o'})>` : `( ${blink ? '-' : 'o'}_${blink ? '-' : 'o'} )`;
    color = isWorking ? 'text-blue-400' : 'text-text-secondary';
    speed = isWorking ? '2s' : '4s';
  } else if (trust <= 80) {
    face = `( ${blink ? '-' : '•'}‿${blink ? '-' : '•'} )`;
    color = 'text-emerald-400';
    speed = '3.5s';
  } else {
    face = `( ${blink ? '-' : '★'}‿${blink ? '-' : '★'} )`;
    color = 'text-violet-400';
    speed = '3s';
  }

  return (
    <div className="font-mono text-center" style={{ animation: `breathe ${speed} ease-in-out infinite` }}>
      <span className={`${color} text-base`}>{face}</span>
    </div>
  );
}

// ── Instance Card ────────────────────────────────────────────────────────────

function InstanceCard({ instance, mission }: { instance: Instance; mission?: MissionData }) {
  const trust = mission?.trustScore ?? 0;
  const cost = Number(mission?.estimatedCost ?? 0) || 0;
  const actions = mission?.progress?.total ?? 0;

  const effectiveRole = mission?.role ?? instance.role ?? instance.inferredRole ?? null;
  const isWorking = mission?.currentStep && mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';
  const hasPending = (mission?.blockedActions ?? 0) > 0 || (mission?.progress?.pending ?? 0) > 0;

  // Current status label
  let statusLabel: string;
  let statusColor: string;
  if (instance.status !== 'running') {
    statusLabel = 'offline';
    statusColor = 'text-zinc-500';
  } else if (!mission) {
    statusLabel = 'connecting...';
    statusColor = 'text-zinc-500';
  } else if (hasPending) {
    statusLabel = 'waiting for you...';
    statusColor = 'text-amber-400';
  } else if ((mission.progress?.denied ?? 0) > 2) {
    statusLabel = `${mission.progress?.denied} denied`;
    statusColor = 'text-red-400';
  } else if (isWorking) {
    statusLabel = mission.currentStep;
    statusColor = 'text-emerald-400';
  } else {
    statusLabel = 'standing by';
    statusColor = 'text-text-tertiary';
  }

  return (
    <Link
      to={`/instances/${instance.id}`}
      className={
        'block rounded-xl border p-5 transition-all hover:border-accent/30 group ' +
        (hasPending
          ? 'border-amber-500/25 bg-surface-1'
          : 'border-border bg-surface-1 hover:bg-surface-1/80')
      }
    >
      <div className="flex items-start gap-4 mb-2">
        <div className="shrink-0 pt-0.5">
          <AgentFace mission={mission} instance={instance} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary truncate">{instance.name}</h3>
            {(mission?.subAgents?.length ?? 0) > 0 && (
              <span className="text-[9px] font-mono text-text-secondary bg-surface-3 px-1.5 py-0.5 rounded-full shrink-0">
                +{mission!.subAgents.length}
              </span>
            )}
            <span className="text-[9px] text-text-tertiary opacity-0 group-hover:opacity-100 transition-opacity">details →</span>
          </div>

          {/* Role */}
          {effectiveRole && (
            <p className="text-[10px] text-accent/70 truncate mt-0.5 font-mono">role: {effectiveRole}</p>
          )}

          {/* Goal — what the agent is working on */}
          {mission?.goal && mission.goal !== instance.name && (
            <p className="text-[10px] text-text-secondary truncate mt-0.5 font-mono">goal: {mission.goal}</p>
          )}
        </div>
      </div>

      {/* Current action */}
      <div className="mb-3">
        <span className={`text-[10px] font-mono ${statusColor} ${hasPending ? 'animate-pulse' : ''} truncate block`}>
          {isWorking ? `> ${statusLabel}` : statusLabel}
          {!hasPending && !isWorking && instance.status === 'running' && <span className="animate-blink"> _</span>}
        </span>
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

          {(mission.progress?.pending ?? 0) > 0 && (
            <span className="ml-auto text-[10px] text-amber-400 font-medium animate-pulse">{mission.progress?.pending} pending</span>
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

  const allInstances = instances ?? [];
  const running = allInstances.filter(i => i.status === 'running');
  const stopped = allInstances.filter(i => i.status !== 'running');
  const pending = approvals ?? [];
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const isEmpty = !loadingInstances && allInstances.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  // Fetch mission data for each running instance (React Query deduplicates with InstanceCard)
  const missionQueries = useQueries({
    queries: running.map(inst => ({
      queryKey: ['mission', inst.id],
      queryFn: () => getMission(inst.id),
      refetchInterval: 5_000,
    })),
  });

  // Weather = average ACTUAL trust score of all running agents
  const weather = useMemo(() => {
    const scores = missionQueries
      .map(q => q.data?.trustScore)
      .filter((s): s is number => s != null);
    if (scores.length === 0) return trustToWeather(50);
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return trustToWeather(avg);
  }, [missionQueries]);

  // Build mission map for passing to InstanceCard
  const missionMap = useMemo(() => {
    const map: Record<string, MissionData> = {};
    for (const q of missionQueries) {
      if (q.data) map[q.data.instanceId] = q.data;
    }
    return map;
  }, [missionQueries]);

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
              <InstanceCard key={inst.id} instance={inst} mission={missionMap[inst.id]} />
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
          </div>
        )}
      </div>
    </div>
  );
}
