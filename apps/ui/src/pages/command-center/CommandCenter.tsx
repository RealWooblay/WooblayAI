/**
 * Dashboard — Unified nerve center + instance management.
 *
 * Everything in one place: agent cards with faces, inline deploy,
 * inline configure, start/stop/restart with warnings, no modals.
 */

import { useMemo, useState, useEffect, useCallback } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  getStats,
  getInstances,
  getApprovals,
  getMission,
  getFlags,
  createInstance,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
  updateInstance,
  getInstanceLogs,
  type Instance,
  type MissionData,
  type CreateInstanceRequest,
} from '../../api/client.ts';
import { Button } from '../../components/common/Button.tsx';
import { WeatherBackground, trustToWeather } from '../../components/weather/WeatherBackground.tsx';
import { useToast } from '../../components/common/Toast.tsx';

// ── Models ───────────────────────────────────────────────────────────────────

const MODELS: { id: string; label: string; tier: string }[] = [
  { id: 'claude-opus-4-20250514', label: 'Claude Opus 4', tier: 'flagship' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4', tier: 'standard' },
  { id: 'claude-4.6-opus', label: 'Claude 4.6 Opus', tier: 'flagship' },
  { id: 'claude-3.5-sonnet-20241022', label: 'Claude 3.5 Sonnet', tier: 'standard' },
  { id: 'claude-3.5-haiku-20241022', label: 'Claude 3.5 Haiku', tier: 'fast' },
  { id: 'gpt-4.1', label: 'GPT-4.1', tier: 'flagship' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', tier: 'standard' },
  { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', tier: 'fast' },
  { id: 'gpt-4o', label: 'GPT-4o', tier: 'standard' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', tier: 'fast' },
  { id: 'o3', label: 'o3', tier: 'flagship' },
  { id: 'o4-mini', label: 'o4-mini', tier: 'standard' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', tier: 'flagship' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', tier: 'fast' },
];


// ── Alive Agent Face ─────────────────────────────────────────────────────────

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
      <div className="font-mono text-center" style={{ animation: 'breathe 6s ease-in-out infinite' }}>
        <span className="text-zinc-600 text-base">( -_- )</span>
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

// ── Inline Deploy Form ───────────────────────────────────────────────────────

function InlineDeployForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [model, setModel] = useState(MODELS[0].id);
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [telegramEnabled, setTelegramEnabled] = useState(false);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramAllowedUsers, setTelegramAllowedUsers] = useState('');

  const createMut = useMutation({
    mutationFn: (body: CreateInstanceRequest) => createInstance(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] });
      toast('Agent deployed', 'success');
      onClose();
    },
    onError: (err) => toast(`Deploy failed: ${err.message}`, 'error'),
  });

  const deploy = () => {
    createMut.mutate({
      name,
      model,
      anthropicApiKey,
      telegramEnabled,
      telegramBotToken: telegramBotToken || undefined,
      telegramAllowedUsers: telegramAllowedUsers || undefined,
    });
  };

  return (
    <div className="rounded-xl border border-accent/30 bg-surface-1 p-5 space-y-3 animate-slide-in-up">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-accent uppercase tracking-wider font-mono font-medium">Deploy New Agent</h3>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary text-xs font-mono">cancel</button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] text-text-tertiary font-mono block mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. code-reviewer"
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50" />
        </div>
        <div>
          <label className="text-[9px] text-text-tertiary font-mono block mb-1">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50">
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label} ({m.tier})</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-text-tertiary font-mono block mb-1">Anthropic API Key</label>
          <input type="password" value={anthropicApiKey} onChange={e => setAnthropicApiKey(e.target.value)} placeholder="sk-ant-..."
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50" />
        </div>
      </div>

      <button onClick={() => setShowAdvanced(!showAdvanced)} className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono">
        {showAdvanced ? '▾' : '▸'} telegram
      </button>

      {showAdvanced && (
        <div className="grid md:grid-cols-3 gap-3 animate-fade-in">
          <label className="flex items-center gap-2 col-span-3">
            <input type="checkbox" checked={telegramEnabled} onChange={e => setTelegramEnabled(e.target.checked)} className="rounded w-3 h-3 accent-accent" />
            <span className="text-[10px] text-text-secondary font-mono">enable telegram</span>
          </label>
          {telegramEnabled && (
            <>
              <div>
                <label className="text-[9px] text-text-tertiary font-mono block mb-1">Bot Token</label>
                <input type="password" value={telegramBotToken} onChange={e => setTelegramBotToken(e.target.value)} placeholder="123456:ABC-..."
                  className="w-full bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50" />
              </div>
              <div className="col-span-2">
                <label className="text-[9px] text-text-tertiary font-mono block mb-1">Allowed User IDs</label>
                <input value={telegramAllowedUsers} onChange={e => setTelegramAllowedUsers(e.target.value)} placeholder="123456789, 987654321"
                  className="w-full bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50" />
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <Button size="xs" onClick={deploy} disabled={!name.trim() || createMut.isPending}>
          {createMut.isPending ? 'deploying...' : 'deploy'}
        </Button>
      </div>
    </div>
  );
}

// ── Inline Configure Form ────────────────────────────────────────────────────

function InlineConfigForm({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const existingConfig = instance.configJson ? JSON.parse(instance.configJson) : {};

  const [model, setModel] = useState(instance.model || MODELS[0].id);
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [telegramEnabled, setTelegramEnabled] = useState(existingConfig.telegramEnabled ?? !!instance.telegramBot);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramAllowedUsers, setTelegramAllowedUsers] = useState(existingConfig.telegramAllowedUsers ?? '');

  const updateMut = useMutation({
    mutationFn: (body: Partial<CreateInstanceRequest>) => updateInstance(instance.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] });
      toast('Config saved', 'success');
      onClose();
    },
    onError: (err) => toast(`Update failed: ${err.message}`, 'error'),
  });

  // Check if any restart-requiring fields are changed
  const willRestart = (model !== (instance.model || MODELS[0].id)) ||
    anthropicApiKey.trim() !== '' ||
    telegramBotToken.trim() !== '' ||
    telegramEnabled !== (existingConfig.telegramEnabled ?? !!instance.telegramBot);

  const save = () => {
    const body: Partial<CreateInstanceRequest> = {};
    if (model !== instance.model) body.model = model;
    if (telegramEnabled !== (existingConfig.telegramEnabled ?? false)) body.telegramEnabled = telegramEnabled;
    if (telegramBotToken.trim()) body.telegramBotToken = telegramBotToken.trim();
    if (telegramAllowedUsers.trim()) body.telegramAllowedUsers = telegramAllowedUsers.trim();
    if (anthropicApiKey.trim()) body.anthropicApiKey = anthropicApiKey.trim();
    updateMut.mutate(body);
  };

  return (
    <div className="border-t border-border/50 pt-3 mt-3 space-y-3 animate-fade-in">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">configure</span>
        <button onClick={onClose} className="text-[10px] text-text-tertiary hover:text-text-secondary font-mono">close</button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <label className="text-[9px] text-text-tertiary font-mono block mb-1">Model</label>
          <select value={model} onChange={e => setModel(e.target.value)}
            className="w-full bg-surface-0 border border-border rounded-lg px-2 py-1.5 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent/50">
            {MODELS.map(m => <option key={m.id} value={m.id}>{m.label} ({m.tier})</option>)}
          </select>
        </div>
        <div>
          <label className="text-[9px] text-text-tertiary font-mono block mb-1">Anthropic API Key</label>
          <input type="password" value={anthropicApiKey} onChange={e => setAnthropicApiKey(e.target.value)}
            placeholder={existingConfig.anthropicApiKey === '***SET***' ? 'set — enter to change' : 'sk-ant-...'}
            className="w-full bg-surface-0 border border-border rounded-lg px-2 py-1.5 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent/50" />
        </div>
        <div>
          <label className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={telegramEnabled} onChange={e => setTelegramEnabled(e.target.checked)} className="rounded w-3 h-3 accent-accent" />
            <span className="text-[9px] text-text-tertiary font-mono">telegram</span>
            {instance.telegramBot && <span className="text-[8px] text-emerald-400 font-mono">active</span>}
          </label>
          {telegramEnabled && (
            <div className="space-y-1.5">
              <input type="password" value={telegramBotToken} onChange={e => setTelegramBotToken(e.target.value)}
                placeholder="bot token..."
                className="w-full bg-surface-0 border border-border rounded-lg px-2 py-1.5 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent/50" />
              <input value={telegramAllowedUsers} onChange={e => setTelegramAllowedUsers(e.target.value)}
                placeholder="allowed user IDs (comma-separated)"
                className="w-full bg-surface-0 border border-border rounded-lg px-2 py-1.5 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent/50" />
            </div>
          )}
        </div>
      </div>

      {/* Restart warning */}
      {willRestart && instance.status === 'running' && (
        <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/8 border border-red-500/20">
          <span className="text-red-400 font-mono text-[10px] font-bold">[!]</span>
          <span className="text-[10px] text-red-300">model / API key / telegram changes require restart — agent memory will be lost</span>
        </div>
      )}

      <div className="flex items-center gap-2 justify-end">
        <Button size="xs" onClick={save} disabled={updateMut.isPending}>
          {updateMut.isPending ? 'saving...' : willRestart && instance.status === 'running' ? 'save & restart' : 'save'}
        </Button>
      </div>
    </div>
  );
}

// ── Instance Card (unified) ──────────────────────────────────────────────────

function InstanceCard({ instance, mission }: { instance: Instance; mission?: MissionData }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [configOpen, setConfigOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const actionOpts = {
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: Error) => toast(err.message, 'error'),
  };

  const startMut = useMutation({ mutationFn: () => startInstance(instance.id), ...actionOpts });
  const stopMut = useMutation({ mutationFn: () => stopInstance(instance.id), ...actionOpts });
  const restartMut = useMutation({ mutationFn: () => restartInstance(instance.id), ...actionOpts });
  const deleteMut = useMutation({
    mutationFn: () => deleteInstance(instance.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['instances'] }); toast('Agent deleted', 'info'); },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const anyLoading = startMut.isPending || stopMut.isPending || restartMut.isPending || deleteMut.isPending;
  const isRunning = instance.status === 'running';

  const trust = mission?.trustScore ?? 0;
  const cost = Number(mission?.estimatedCost ?? 0) || 0;
  const actions = mission?.progress?.total ?? 0;
  const effectiveRole = mission?.role ?? instance.role ?? instance.inferredRole ?? null;
  const isWorking = mission?.currentStep && mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';
  const hasPending = (mission?.blockedActions ?? 0) > 0 || (mission?.progress?.pending ?? 0) > 0;

  let statusLabel: string;
  let statusColor: string;
  if (!isRunning) {
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

  const loadLogs = useCallback(async () => {
    try {
      const res = await getInstanceLogs(instance.id, 80);
      setLogs(res.logs);
    } catch { setLogs('Failed to load logs'); }
  }, [instance.id]);

  const [restartConfirm, setRestartConfirm] = useState(false);

  // Trust ring math
  const ringR = 30;
  const ringC = 2 * Math.PI * ringR;

  return (
    <div className={`rounded-xl border transition-all hover:border-border-strong ${
      hasPending ? 'border-amber-500/25 bg-surface-1' : 'border-border bg-surface-1'
    }`}>
      {/* Main content: horizontal layout */}
      <div className="flex items-start gap-5 p-5">
        {/* Left: Face with trust ring */}
        <Link to={`/instances/${instance.id}`} className="shrink-0 group">
          <div className="relative">
            <svg width="72" height="72" viewBox="0 0 72 72" className="absolute -inset-0.5">
              <circle cx="36" cy="36" r={ringR} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="2.5" />
              {isRunning && (
                <circle cx="36" cy="36" r={ringR} fill="none"
                  stroke={trust > 70 ? '#34d399' : trust > 40 ? '#fbbf24' : '#f87171'}
                  strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={`${(trust / 100) * ringC} ${ringC}`}
                  transform="rotate(-90 36 36)"
                  style={{ transition: 'all 0.6s ease' }} />
              )}
            </svg>
            <div className="w-[72px] h-[72px] flex items-center justify-center">
              <AgentFace mission={mission} instance={instance} />
            </div>
          </div>
          {isRunning && (
            <div className="text-center mt-1">
              <span className={`text-[10px] font-bold tabular-nums font-mono ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                {trust}
              </span>
            </div>
          )}
        </Link>

        {/* Right: Info */}
        <div className="flex-1 min-w-0 pt-0.5">
          {/* Name row */}
          <div className="flex items-center gap-2 mb-1">
            <Link to={`/instances/${instance.id}`}
              className="text-sm font-semibold text-text-primary font-mono hover:text-accent transition-colors truncate">
              {instance.name}
            </Link>
            {(mission?.subAgents?.length ?? 0) > 0 && (
              <span className="text-[9px] font-mono text-text-secondary bg-surface-3 px-1.5 py-0.5 rounded-full shrink-0">
                +{mission!.subAgents.length}
              </span>
            )}
          </div>

          {/* Role */}
          {effectiveRole && <p className="text-[11px] text-text-secondary truncate font-mono mb-1">{effectiveRole}</p>}

          {/* Status line */}
          <div className="mb-2">
            <span className={`text-[11px] font-mono ${statusColor} ${hasPending ? 'animate-pulse' : ''} truncate block`}>
              {isWorking ? `> ${statusLabel}` : statusLabel}
              {!hasPending && !isWorking && isRunning && <span className="animate-blink"> _</span>}
            </span>
          </div>

          {/* Metrics row */}
          {mission && (
            <div className="flex items-center gap-4">
              <span className="text-[11px] text-text-secondary font-mono tabular-nums">${cost.toFixed(2)}</span>
              <span className="text-[11px] text-text-tertiary font-mono tabular-nums">{actions} actions</span>
              {(mission.progress?.pending ?? 0) > 0 && (
                <span className="text-[10px] text-amber-400 font-medium animate-pulse font-mono">{mission.progress?.pending} pending</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Action bar — clean separator */}
      <div className="flex items-center gap-2 px-5 py-2.5 border-t border-border/40 bg-surface-0/30 rounded-b-xl">
        {!isRunning && (
          <button onClick={() => startMut.mutate()} disabled={anyLoading}
            className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 disabled:opacity-40 px-2.5 py-1 rounded-md bg-emerald-500/8 hover:bg-emerald-500/15 transition-colors">
            {startMut.isPending ? 'starting...' : 'start'}
          </button>
        )}
        {isRunning && (
          <>
            {!restartConfirm ? (
              <button onClick={() => setRestartConfirm(true)} disabled={anyLoading}
                className="text-[11px] font-mono text-amber-400 hover:text-amber-300 disabled:opacity-40 px-2.5 py-1 rounded-md bg-amber-500/8 hover:bg-amber-500/15 transition-colors">
                restart
              </button>
            ) : (
              <div className="flex items-center gap-1.5 animate-fade-in">
                <span className="text-[10px] text-red-400 font-mono">[!] memory lost —</span>
                <button onClick={() => { restartMut.mutate(); setRestartConfirm(false); }}
                  className="text-[11px] font-mono text-red-400 hover:text-red-300 px-2 py-0.5 rounded-md bg-red-500/10 hover:bg-red-500/20">
                  {restartMut.isPending ? '...' : 'confirm'}
                </button>
                <button onClick={() => setRestartConfirm(false)} className="text-[11px] font-mono text-text-tertiary hover:text-text-secondary px-1">cancel</button>
              </div>
            )}
            <button onClick={() => stopMut.mutate()} disabled={anyLoading}
              className="text-[11px] font-mono text-text-tertiary hover:text-text-secondary disabled:opacity-40 px-2.5 py-1 rounded-md hover:bg-surface-3/50 transition-colors">
              {stopMut.isPending ? 'stopping...' : 'stop'}
            </button>
          </>
        )}
        <button onClick={() => setConfigOpen(!configOpen)}
          className={`text-[11px] font-mono px-2.5 py-1 rounded-md transition-colors ${
            configOpen ? 'text-accent bg-accent/10' : 'text-text-tertiary hover:text-text-secondary hover:bg-surface-3/50'
          }`}>
          config
        </button>
        <button onClick={() => { setShowLogs(!showLogs); if (!showLogs) loadLogs(); }}
          className="text-[11px] font-mono text-text-tertiary hover:text-text-secondary px-2.5 py-1 rounded-md hover:bg-surface-3/50 transition-colors">
          {showLogs ? 'hide logs' : 'logs'}
        </button>
        <Link to={`/instances/${instance.id}`}
          className="text-[11px] font-mono text-text-tertiary hover:text-accent px-2.5 py-1 rounded-md hover:bg-surface-3/50 transition-colors ml-auto">
          details →
        </Link>

        {!confirmDelete ? (
          <button onClick={() => setConfirmDelete(true)} disabled={anyLoading}
            className="text-[11px] font-mono text-red-400/30 hover:text-red-400 transition-colors px-1">
            ×
          </button>
        ) : (
          <div className="flex items-center gap-1.5 animate-fade-in">
            <button onClick={() => { deleteMut.mutate(); setConfirmDelete(false); }}
              className="text-[10px] font-mono text-red-400 hover:text-red-300 px-2 py-0.5 rounded-md bg-red-500/10">
              {deleteMut.isPending ? '...' : 'delete'}
            </button>
            <button onClick={() => setConfirmDelete(false)} className="text-[10px] font-mono text-text-tertiary">cancel</button>
          </div>
        )}
      </div>

      {/* Expandable panels */}
      {configOpen && (
        <div className="px-5 pb-4">
          <InlineConfigForm instance={instance} onClose={() => setConfigOpen(false)} />
        </div>
      )}
      {showLogs && (
        <div className="px-5 pb-4 animate-fade-in">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono">logs</span>
            <button onClick={loadLogs} className="text-[10px] text-accent font-mono">refresh</button>
          </div>
          <pre className="text-[10px] font-mono text-text-muted bg-surface-0 rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
            {logs ?? 'loading...'}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export function CommandCenter() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 5_000 });
  const { data: instances, isLoading: loadingInstances } = useQuery({ queryKey: ['instances'], queryFn: getInstances, refetchInterval: 5_000 });
  const { data: approvals } = useQuery({ queryKey: ['approvals', 'pending'], queryFn: getApprovals, refetchInterval: 5_000 });
  const { data: flagsData } = useQuery({ queryKey: ['flags', 'dashboard'], queryFn: () => getFlags({ dismissed: 'false', limit: '5' }), refetchInterval: 10_000 });

  const [deployOpen, setDeployOpen] = useState(false);

  const allInstances = instances ?? [];
  const running = allInstances.filter(i => i.status === 'running');
  const stopped = allInstances.filter(i => i.status !== 'running');
  const pending = approvals ?? [];
  const flags = flagsData?.flags ?? [];
  const criticalFlags = flags.filter(f => f.severity === 'CRITICAL' || f.severity === 'HIGH');
  const isEmpty = !loadingInstances && allInstances.length === 0;
  const hasData = (stats?.totalToolCalls ?? 0) > 0;

  const missionQueries = useQueries({
    queries: running.map(inst => ({
      queryKey: ['mission', inst.id],
      queryFn: () => getMission(inst.id),
      refetchInterval: 5_000,
    })),
  });

  const weather = useMemo(() => {
    const scores = missionQueries.map(q => q.data?.trustScore).filter((s): s is number => s != null);
    if (scores.length === 0) return trustToWeather(50);
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    return trustToWeather(avg);
  }, [missionQueries]);

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
              <div className="flex items-center gap-4 mt-1.5">
                <span className="text-xs text-text-secondary font-mono">{stats!.totalToolCalls} actions</span>
                {stats!.pendingApprovals > 0 && (
                  <span className="text-xs text-amber-400 font-mono">{stats!.pendingApprovals} pending</span>
                )}
                {hasData && stats?.byDecision && (stats.byDecision['DENY'] ?? 0) > 0 && (
                  <span className="text-xs text-red-400/70 font-mono">{stats.byDecision['DENY']} denied</span>
                )}
              </div>
            )}
          </div>
          <button onClick={() => setDeployOpen(!deployOpen)}
            className={`text-xs font-mono px-4 py-2 rounded-lg transition-colors ${
              deployOpen ? 'bg-accent/10 text-accent' : 'bg-accent text-white hover:bg-accent-bright'
            }`}>
            {deployOpen ? 'cancel' : '+ deploy agent'}
          </button>
        </div>

        {/* Inline Deploy */}
        {deployOpen && <InlineDeployForm onClose={() => setDeployOpen(false)} />}

        {/* Critical Flags */}
        {criticalFlags.length > 0 && (
          <Link to="/activity" className="block p-3 rounded-xl bg-red-500/8 border border-red-500/20 hover:border-red-500/30 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-mono text-red-400 text-xs font-bold">[!]</span>
              <span className="text-xs text-red-300">{criticalFlags.length} anomal{criticalFlags.length !== 1 ? 'ies' : 'y'} detected</span>
              <span className="text-[10px] text-red-400/60 ml-auto font-mono">view →</span>
            </div>
          </Link>
        )}

        {/* Pending Approvals */}
        {pending.length > 0 && (
          <Link to="/approvals" className="block p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 hover:border-amber-500/40 transition-colors">
            <div className="flex items-center gap-3">
              <span className="font-mono text-amber-400 text-xs animate-blink">[?]</span>
              <span className="text-xs text-amber-300 font-medium">{pending.length} action{pending.length !== 1 ? 's' : ''} waiting for approval</span>
              <span className="text-[10px] text-amber-400/60 ml-auto font-mono">review →</span>
            </div>
          </Link>
        )}

        {/* Empty State */}
        {isEmpty && !hasData && !deployOpen && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="font-mono text-text-tertiary text-xs leading-relaxed mb-6">
              <div className="border border-border rounded-xl p-6 inline-block">
                <div className="text-2xl mb-2" style={{ animation: 'breathe 4s ease-in-out infinite' }}>( o_o )</div>
                <div className="text-text-secondary">hi there</div>
                <div className="text-text-tertiary mt-1">no agents running</div>
                <div className="text-text-tertiary">deploy one to start</div>
              </div>
            </div>
            <button onClick={() => setDeployOpen(true)}
              className="px-4 py-2 bg-accent text-white text-xs font-mono rounded-lg hover:bg-accent-bright transition-colors">
              Deploy Your First Agent
            </button>
          </div>
        )}

        {/* Running Agents */}
        {running.length > 0 && (
          <div className={`grid gap-3 ${running.length > 1 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
            {running.map(inst => (
              <InstanceCard key={inst.id} instance={inst} mission={missionMap[inst.id]} />
            ))}
          </div>
        )}

        {/* Stopped Agents */}
        {stopped.length > 0 && (
          <div>
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider font-mono mb-2">offline</p>
            <div className={`grid gap-3 ${stopped.length > 2 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {stopped.map(inst => (
                <InstanceCard key={inst.id} instance={inst} mission={undefined} />
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
