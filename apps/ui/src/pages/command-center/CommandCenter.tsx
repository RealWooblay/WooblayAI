/**
 * Dashboard — The Nerve Center
 *
 * ASCII-flavored command center. Agents feel alive.
 * Minimal but characterful. Links to instance deep-dives.
 */

import { useMemo } from 'react';
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
import { Tooltip } from '../../components/common/Tooltip.tsx';

// ── ASCII Rain Background ─────────────────────────────────────────────────────

const RAIN_CHARS = '01.:·|{}[]<>/\\─│┌┐└┘├┤┬┴┼═║╔╗╚╝░▒▓';

function AsciiRain() {
  const columns = useMemo(() => {
    const cols: Array<{ left: number; chars: string; duration: number; delay: number; slow: boolean }> = [];
    for (let i = 0; i < 18; i++) {
      const len = 6 + Math.floor(Math.random() * 14);
      let chars = '';
      for (let j = 0; j < len; j++) {
        chars += RAIN_CHARS[Math.floor(Math.random() * RAIN_CHARS.length)];
      }
      cols.push({
        left: 2 + (i * (96 / 18)) + (Math.random() * 3 - 1.5),
        chars,
        duration: 12 + Math.random() * 20,
        delay: Math.random() * -25,
        slow: Math.random() > 0.5,
      });
    }
    return cols;
  }, []);

  return (
    <div className="ascii-rain">
      {columns.map((col, i) => (
        <div
          key={i}
          className={`ascii-rain-col ${col.slow ? 'slow' : ''}`}
          style={{
            left: `${col.left}%`,
            '--duration': `${col.duration}s`,
            '--delay': `${col.delay}s`,
          } as React.CSSProperties}
        >
          {col.chars}
        </div>
      ))}
    </div>
  );
}

// ── ASCII Agent Character ────────────────────────────────────────────────────

const IDLE_FRAMES = ['( o_o )', '( o_o )', '( o_o )', '( -_o )'];
const WORKING_FRAMES = ['( •_•)>', '( •_•)>>', '( •_•)>>>', '( •_• )'];
const BLOCKED_FRAMES = ['( ._. )', '( ;_; )', '( ._. )', '( ._. )'];
const DENIED_FRAMES = ['( x_x )', '( X_X )', '( x_x )', '( X_X )'];

function useAnimFrame(frames: string[], ms = 600) {
  const idx = Math.floor(Date.now() / ms) % frames.length;
  return frames[idx];
}

function AgentFace({ mission, instance }: { mission?: MissionData; instance: Instance }) {
  const idle = useAnimFrame(IDLE_FRAMES, 1200);
  const working = useAnimFrame(WORKING_FRAMES, 400);
  const blocked = useAnimFrame(BLOCKED_FRAMES, 800);
  const denied = useAnimFrame(DENIED_FRAMES, 500);

  if (instance.status !== 'running') {
    return <span className="font-mono text-zinc-600 text-sm">( -_- ) zzz</span>;
  }
  if (!mission) return <span className="font-mono text-zinc-500 text-sm animate-pulse">( ... )</span>;

  const hasDenied = mission.progress.denied > 2;
  const hasPending = mission.blockedActions > 0 || mission.progress.pending > 0;
  const isWorking = mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';

  if (hasDenied) return <span className="font-mono text-red-400 text-sm">{denied}</span>;
  if (hasPending) return <span className="font-mono text-amber-400 text-sm">{blocked}</span>;
  if (isWorking) return <span className="font-mono text-emerald-400 text-sm">{working}</span>;
  return <span className="font-mono text-text-secondary text-sm">{idle}</span>;
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
  if (hasPending) return <span className="text-[10px] text-amber-400 font-mono animate-pulse">waiting for your approval...</span>;
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
      {/* Agent character + name */}
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

      {/* Metrics bar */}
      {mission && (
        <div className="flex items-center gap-4 pt-3 border-t border-border/50">
          <Tooltip content="Trust: 0 = untrusted, 100 = fully autonomous. Based on approval history & AI analysis.">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-text-tertiary">Trust</span>
              <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                <div className={`h-full rounded-full transition-all ${trust > 70 ? 'bg-emerald-500' : trust > 40 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${trust}%` }} />
              </div>
              <span className={`text-[10px] font-bold tabular-nums ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {trust}
              </span>
            </div>
          </Tooltip>

          <Tooltip content="Estimated session cost">
            <span className="text-[10px] text-text-secondary font-mono tabular-nums">${cost.toFixed(2)}</span>
          </Tooltip>

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
  const { data: flagsData } = useQuery({
    queryKey: ['flags', 'dashboard'],
    queryFn: () => getFlags({ dismissed: 'false', limit: '5' }),
    refetchInterval: 10_000,
  });

  const allInstances = instances ?? [];
  const running = allInstances.filter(i => i.status === 'running');
  const stopped = allInstances.filter(i => i.status !== 'running');
  const pending = approvals ?? [];
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const isEmpty = !loadingInstances && allInstances.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  return (
    <div className="h-full overflow-y-auto p-6 canvas-bg relative">
      <AsciiRain />
      <div className="scanline-overlay" />
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
          <Link
            to="/activity"
            className="block p-3 rounded-xl bg-red-500/8 border border-red-500/20 hover:border-red-500/30 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-red-400 text-xs font-bold">[!]</span>
              <span className="text-xs text-red-300">{criticalFlags.length} anomal{criticalFlags.length !== 1 ? 'ies' : 'y'} detected</span>
              <span className="text-[10px] text-red-400/60 ml-auto font-mono">review →</span>
            </div>
          </Link>
        )}

        {/* Pending Approvals Banner */}
        {pending.length > 0 && (
          <Link
            to="/approvals"
            className="block p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 hover:border-amber-500/40 transition-colors"
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-amber-400 text-xs animate-blink">[?]</span>
              <span className="text-xs text-amber-300 font-medium">
                {pending.length} action{pending.length !== 1 ? 's' : ''} waiting for your approval
              </span>
              <span className="text-[10px] text-amber-400/60 ml-auto font-mono">review →</span>
            </div>
          </Link>
        )}

        {/* Empty State */}
        {isEmpty && !hasData && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <pre className="text-text-tertiary text-xs font-mono mb-6 leading-relaxed">{`
  ┌─────────────────────────┐
  │                         │
  │   ( o_o )  hi there     │
  │                         │
  │   no agents running     │
  │   deploy one to start   │
  │                         │
  └─────────────────────────┘
            `}</pre>
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
                <Link
                  key={inst.id}
                  to={`/instances/${inst.id}`}
                  className="rounded-lg border border-border bg-surface-0 p-3 opacity-50 hover:opacity-80 transition-all"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-zinc-600">( -_- )</span>
                    <span className="text-xs text-text-tertiary truncate flex-1">{inst.name}</span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Quick Stats Footer */}
        {hasData && running.length > 0 && (
          <div className="pt-3 border-t border-border/30 flex items-center gap-6">
            <Link to="/activity" className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono transition-colors">
              activity →
            </Link>
            <Link to="/policies" className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono transition-colors">
              policies →
            </Link>
            <Link to="/audit" className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono transition-colors">
              audit →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
