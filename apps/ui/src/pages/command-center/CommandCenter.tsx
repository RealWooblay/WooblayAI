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
  getOrgPolicySettings,
  getApiKeys,
  getAgentContainerState,
  isContainerReady,
  type Instance,
  type MissionData,
  type CreateInstanceRequest,
} from '../../api/client.ts';
import { Button } from '../../components/common/Button.tsx';
import { WeatherBackground, trustToWeather } from '../../components/weather/WeatherBackground.tsx';
import { useToast } from '../../components/common/Toast.tsx';
import { IconZap, IconLock, IconShield } from '../../components/icons.tsx';

// ── Models ───────────────────────────────────────────────────────────────────

const POPULAR_MODELS: { id: string; label: string; tier: string }[] = [
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

function ModelSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const isCustom = !POPULAR_MODELS.some((m) => m.id === value);
  const [showCustom, setShowCustom] = useState(isCustom);

  if (showCustom) {
    return (
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Model ID (e.g. llama-3.1-70b)"
          className="flex-1 bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono placeholder:text-text-muted focus:outline-none focus:border-accent/50"
        />
        <button type="button" onClick={() => { setShowCustom(false); onChange(POPULAR_MODELS[0].id); }} className="text-[10px] text-text-muted hover:text-text-secondary whitespace-nowrap">presets</button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50"
      >
        {POPULAR_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label} ({m.tier})</option>
        ))}
      </select>
      <button type="button" onClick={() => { setShowCustom(true); onChange(''); }} className="text-[10px] text-text-muted hover:text-text-secondary whitespace-nowrap">custom</button>
    </div>
  );
}


// ── Alive Agent Face ─────────────────────────────────────────────────────────

function AgentFace({ mission, isContainerUp }: { mission?: MissionData; instance: Instance; isContainerUp: boolean }) {
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

  if (!isContainerUp) {
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
  const [model, setModel] = useState(POPULAR_MODELS[0].id);
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
          <ModelSelector value={model} onChange={setModel} />
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

  const [model, setModel] = useState(instance.model || POPULAR_MODELS[0].id);
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
  const willRestart = (model !== (instance.model || POPULAR_MODELS[0].id)) ||
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
          <ModelSelector value={model} onChange={setModel} />
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

  const startMut = useMutation({
    mutationFn: () => startInstance(instance.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const stopMut = useMutation({ mutationFn: () => stopInstance(instance.id), ...actionOpts });
  const restartMut = useMutation({ mutationFn: () => restartInstance(instance.id), ...actionOpts });
  const deleteMut = useMutation({
    mutationFn: () => deleteInstance(instance.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['instances'] }); toast('Agent deleted', 'info'); },
    onError: (err: Error) => toast(err.message, 'error'),
  });

  const anyLoading = startMut.isPending || stopMut.isPending || restartMut.isPending || deleteMut.isPending;
  const containerState = getAgentContainerState(instance, { startPending: startMut.isPending, stopPending: stopMut.isPending });
  const isContainerUp = isContainerReady(instance);

  const trust = mission?.trustScore ?? 0;
  const cost = Number(mission?.estimatedCost ?? 0) || 0;
  const actions = mission?.progress?.total ?? 0;
  const effectiveRole = mission?.role ?? instance.role ?? instance.inferredRole ?? null;
  const isWorking = mission?.currentStep && mission.currentStep !== 'Idle' && mission.currentStep !== 'No activity yet';
  const hasPending = (mission?.blockedActions ?? 0) > 0 || (mission?.progress?.pending ?? 0) > 0;

  let statusLabel: string;
  let statusColor: string;
  if (containerState === 'stopping') {
    statusLabel = 'Stopping…';
    statusColor = 'text-amber-400';
  } else if (containerState === 'starting' || containerState === 'restarting') {
    statusLabel = containerState === 'restarting' ? 'Restarting…' : 'Starting…';
    statusColor = 'text-amber-400';
  } else if (!isContainerUp) {
    statusLabel = 'offline';
    statusColor = 'text-zinc-500';
  } else if (!mission) {
    statusLabel = 'connecting…';
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

  return (
    <div className={`rounded-xl border transition-all hover:border-border-strong ${
      hasPending ? 'border-amber-500/25 bg-surface-1' : 'border-border bg-surface-1'
    }`}>
      {/* Main content: horizontal layout */}
      <div className="flex items-start gap-5 p-5">
        {/* Left: Face (clean, no ring) */}
        <Link to={`/instances/${instance.id}`} className="shrink-0 group">
          <div className="w-[72px] h-[72px] flex items-center justify-center">
            <AgentFace mission={mission} instance={instance} isContainerUp={isContainerUp} />
          </div>
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
              {!hasPending && !isWorking && isContainerUp && <span className="animate-blink"> _</span>}
            </span>
          </div>

          {/* Running = API key in use — stop when not in use to avoid spend */}
          {isContainerUp && (
            <p className="text-[10px] text-text-muted font-mono mb-1.5">
              Your Anthropic key is in use while running — stop when not in use to avoid API spend.
            </p>
          )}
          {/* Metrics row: trust bar + cost + actions */}
          {mission && (
            <div className="flex items-center gap-4">
              {isContainerUp && (
                <div className="flex items-center gap-1.5">
                  <span className={`text-[10px] font-bold tabular-nums font-mono ${trust > 70 ? 'text-emerald-400' : trust > 40 ? 'text-amber-400' : 'text-red-400'}`}>
                    {trust}
                  </span>
                  <div className="w-16 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${trust > 70 ? 'bg-emerald-400' : trust > 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${trust}%` }}
                    />
                  </div>
                </div>
              )}
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
        {containerState === 'offline' && (
          <button onClick={() => startMut.mutate()} disabled={anyLoading}
            className="text-[11px] font-mono text-emerald-400 hover:text-emerald-300 disabled:opacity-40 px-2.5 py-1 rounded-md bg-emerald-500/8 hover:bg-emerald-500/15 transition-colors">
            {startMut.isPending ? 'starting…' : 'start'}
          </button>
        )}
        {containerState !== 'offline' && (
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

// ── Inline Proxy Deploy ──────────────────────────────────────────────────────

function InlineProxyDeployForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState('');

  const createMut = useMutation({
    mutationFn: () => createInstance({ name, instanceType: 'proxy' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] });
      toast('MCP Proxy deployed — configure tools in the detail view', 'success');
      onClose();
    },
    onError: (err) => toast(`Deploy failed: ${err.message}`, 'error'),
  });

  return (
    <div className="rounded-xl border border-violet-500/30 bg-surface-1 p-5 space-y-3 animate-slide-in-up">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-violet-400 uppercase tracking-wider font-mono font-medium">Deploy MCP Proxy</h3>
        <button onClick={onClose} className="text-text-tertiary hover:text-text-secondary text-xs font-mono">cancel</button>
      </div>
      <p className="text-[10px] text-text-muted">
        Secure MCP firewall for external agents (Claude Desktop, Cursor, etc). No hosted agent — just the security membrane.
      </p>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[9px] text-text-tertiary font-mono block mb-1">Name</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. my-firewall"
            onKeyDown={e => e.key === 'Enter' && name.trim() && createMut.mutate()}
            className="w-full bg-surface-0 border border-border rounded-lg px-3 py-1.5 text-xs text-text-primary font-mono focus:outline-none focus:border-accent/50" />
        </div>
        <Button size="xs" onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
          {createMut.isPending ? 'deploying...' : 'deploy'}
        </Button>
      </div>
    </div>
  );
}

// ── Firewall Dashboard (firewall mode) ───────────────────────────────────────

function FirewallDashboard() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 5_000 });
  const { data: approvals } = useQuery({ queryKey: ['approvals', 'pending'], queryFn: getApprovals, refetchInterval: 5_000 });
  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys });
  const { data: instances } = useQuery({ queryKey: ['instances'], queryFn: getInstances, refetchInterval: 5_000 });

  const [proxyDeployOpen, setProxyDeployOpen] = useState(false);

  const pending = approvals ?? [];
  const totalActions = stats?.totalToolCalls ?? 0;
  const pendingApprovals = stats?.pendingApprovals ?? 0;
  const deniedActions = stats?.byDecision?.DENY ?? 0;
  const proxyInstances = (instances ?? []).filter(i => i.instanceType === 'proxy');

  return (
    <div className="h-full overflow-y-auto animate-fade-in"><div className="container-page">
      <div className="max-w-3xl mx-auto space-y-5">
        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-primary">Wooblay Gate</h1>
            <p className="text-xs text-text-muted mt-1">
              AI agent firewall — policy enforcement, credential isolation, secure execution.
            </p>
          </div>
        </div>

        {/* Inline proxy deploy */}
        {proxyDeployOpen && <InlineProxyDeployForm onClose={() => setProxyDeployOpen(false)} />}

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Actions Today</p>
            <p className="text-2xl font-bold font-mono text-text-primary">{totalActions}</p>
          </div>
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Pending Review</p>
            <p className="text-2xl font-bold font-mono text-amber-400">{pendingApprovals}</p>
          </div>
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">Blocked</p>
            <p className="text-2xl font-bold font-mono text-red-400">{deniedActions}</p>
          </div>
          <div className="bg-surface-1 border border-border rounded-xl p-4">
            <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">API Keys</p>
            <p className="text-2xl font-bold font-mono text-accent-bright">{apiKeys.length}</p>
          </div>
        </div>

        {/* Proxy instances */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[10px] text-text-muted uppercase tracking-wider font-mono">MCP Proxies</h2>
            <button onClick={() => setProxyDeployOpen(!proxyDeployOpen)}
              className={`text-xs font-mono px-4 py-2 rounded-lg transition-colors ${
                proxyDeployOpen ? 'bg-violet-500/10 text-violet-400' : 'bg-accent text-white hover:bg-accent-bright'
              }`}>
              {proxyDeployOpen ? 'cancel' : '+ deploy proxy'}
            </button>
          </div>
          {proxyInstances.length > 0 && proxyInstances.map(inst => (
              <Link key={inst.id} to={`/instances/${inst.id}`}
                className="flex items-center justify-between bg-surface-1 border border-border rounded-xl p-4 hover:bg-surface-2 transition-colors">
                <div className="flex items-center gap-3">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-violet-500/10 text-violet-400">Proxy</span>
                  <span className="text-sm font-medium text-text-primary font-mono">{inst.name}</span>
                </div>
                <span className={`text-[10px] font-mono ${inst.status === 'running' ? 'text-emerald-400' : inst.status === 'error' ? 'text-red-400' : 'text-text-muted'}`}>
                  {inst.status}
                </span>
              </Link>
            ))}
        </div>

        {/* Pending approvals alert */}
        {pending.length > 0 && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-amber-400">⬡</span>
                <p className="text-sm font-medium text-amber-400">
                  {pending.length} action{pending.length !== 1 ? 's' : ''} awaiting approval
                </p>
              </div>
              <Link to="/approvals" className="text-xs text-amber-400 hover:text-amber-300 font-medium">
                Review &rarr;
              </Link>
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-3 gap-3">
          <Link to="/setup" className="bg-surface-1 border border-border rounded-xl p-4 hover:bg-surface-2 transition-colors group">
            <IconZap size={18} className="text-accent mb-2" />
            <p className="text-[11px] font-medium text-text-primary mb-1 group-hover:text-accent-bright">Gateway &rarr;</p>
            <p className="text-[10px] text-text-muted">Connect Cursor, Claude, or HTTP</p>
          </Link>
          <Link to="/credentials" className="bg-surface-1 border border-border rounded-xl p-4 hover:bg-surface-2 transition-colors group">
            <IconLock size={18} className="text-accent mb-2" />
            <p className="text-[11px] font-medium text-text-primary mb-1 group-hover:text-accent-bright">Credentials &rarr;</p>
            <p className="text-[10px] text-text-muted">Manage credential vault</p>
          </Link>
          <Link to="/policies" className="bg-surface-1 border border-border rounded-xl p-4 hover:bg-surface-2 transition-colors group">
            <IconShield size={18} className="text-accent mb-2" />
            <p className="text-[11px] font-medium text-text-primary mb-1 group-hover:text-accent-bright">Policies &rarr;</p>
            <p className="text-[10px] text-text-muted">Configure allow/deny rules</p>
          </Link>
        </div>

        {/* No keys state */}
        {apiKeys.length === 0 && (
          <div className="bg-surface-1 border border-dashed border-border rounded-xl p-6 text-center">
            <p className="text-sm text-text-secondary mb-2">No API keys yet</p>
            <p className="text-xs text-text-muted mb-4">Create your first API key to connect an external agent to Wooblay.</p>
            <Link to="/setup">
              <Button size="sm">Go to Gateway</Button>
            </Link>
          </div>
        )}

        {/* Audit link */}
        <div className="flex justify-between items-center pt-2">
          <Link to="/audit" className="text-xs text-text-muted hover:text-accent transition-colors">
            View full audit log &rarr;
          </Link>
          <Link to="/notifications" className="text-xs text-text-muted hover:text-accent transition-colors">
            Configure alerts &rarr;
          </Link>
        </div>
      </div>
    </div></div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────────────────────

export function CommandCenter() {
  // Check platform mode
  const { data: orgSettings } = useQuery({
    queryKey: ['org-settings'],
    queryFn: getOrgPolicySettings,
    staleTime: 60_000,
  });
  const platformMode = (orgSettings as any)?.platformMode ?? 'firewall';

  if (platformMode === 'firewall') {
    return <FirewallDashboard />;
  }

  return <FullPlatformDashboard />;
}

function FullPlatformDashboard() {
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 5_000 });
  const { data: instances, isLoading: loadingInstances } = useQuery({ queryKey: ['instances'], queryFn: getInstances, refetchInterval: 5_000 });
  const { data: approvals } = useQuery({ queryKey: ['approvals', 'pending'], queryFn: getApprovals, refetchInterval: 5_000 });
  const { data: flagsData } = useQuery({ queryKey: ['flags', 'dashboard'], queryFn: () => getFlags({ dismissed: 'false', limit: '5' }), refetchInterval: 10_000 });

  const [deployOpen, setDeployOpen] = useState<false | 'agent' | 'proxy'>(false);

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
    <div className="h-full overflow-y-auto animate-fade-in"><div className="container-page">
      <WeatherBackground weather={weather} />
      <div className="max-w-4xl mx-auto space-y-5" data-tour="tour-agents">

        {/* Header */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-lg font-bold text-text-primary">
              {isEmpty && !hasData ? 'Wooblay' : running.length > 0 ? `${running.length} agent${running.length !== 1 ? 's' : ''} active` : 'Agents'}
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
          <div className="flex gap-2">
            <button onClick={() => setDeployOpen(deployOpen === 'proxy' ? false : 'proxy')}
              className={`text-xs font-mono px-3 py-2 rounded-lg transition-colors ${
                deployOpen === 'proxy' ? 'bg-violet-500/10 text-violet-400' : 'bg-surface-1 border border-border text-text-secondary hover:border-violet-500/50 hover:text-violet-400'
              }`}>
              {deployOpen === 'proxy' ? 'cancel' : '+ proxy'}
            </button>
            <button onClick={() => setDeployOpen(deployOpen === 'agent' ? false : 'agent')}
              data-tour="tour-deploy"
              className={`text-xs font-mono px-3 py-2 rounded-lg transition-colors ${
                deployOpen === 'agent' ? 'bg-accent/10 text-accent' : 'bg-accent text-white hover:bg-accent-bright'
              }`}>
              {deployOpen === 'agent' ? 'cancel' : '+ agent'}
            </button>
          </div>
        </div>

        {/* Inline Deploy */}
        {deployOpen === 'agent' && <InlineDeployForm onClose={() => setDeployOpen(false)} />}
        {deployOpen === 'proxy' && <InlineProxyDeployForm onClose={() => setDeployOpen(false)} />}

        {/* Critical Flags */}
        {criticalFlags.length > 0 && (
          <Link to="/audit" className="block p-3 rounded-xl bg-red-500/8 border border-red-500/20 hover:border-red-500/30 transition-colors">
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
              <span className="font-mono text-amber-400 text-xs">[?]</span>
              <span className="text-xs text-amber-300 font-medium">{pending.length} action{pending.length !== 1 ? 's' : ''} waiting for approval</span>
              <span className="text-[10px] text-amber-400/60 ml-auto font-mono">review →</span>
            </div>
          </Link>
        )}

        {/* Empty State — Setup Checklist */}
        {isEmpty && !hasData && !deployOpen && (
          <div className="space-y-4">
            {/* Welcome */}
            <div className="text-center py-8">
              <div className="font-mono text-2xl mb-3">( o_o )</div>
              <h2 className="text-lg font-semibold text-text-primary">Welcome to Wooblay</h2>
              <p className="text-xs text-text-secondary mt-1 max-w-md mx-auto">
                The secure execution environment for AI agents. Set up your platform in 3 steps.
              </p>
            </div>

            {/* Setup Checklist */}
            <div className="bg-surface-1 border border-border rounded-xl p-5 max-w-lg mx-auto">
              <h3 className="text-[11px] text-text-tertiary uppercase tracking-wider mb-4">Setup Checklist</h3>
              <div className="space-y-3">
                <SetupStep
                  number={1}
                  title="Deploy an Instance"
                  description="Deploy a hosted agent or an MCP proxy for external agents. Both are secured by the Gate."
                  done={false}
                  action={() => setDeployOpen('agent')}
                  actionLabel="Deploy Agent"
                />
                <SetupStep
                  number={2}
                  title="Add Credentials"
                  description="Link your services so Wooblay can detect events and execute actions securely."
                  done={false}
                  actionLabel="Add Credentials"
                  href="/credentials"
                />
                <SetupStep
                  number={3}
                  title="Configure Policies"
                  description="Set what your agents can do. Auto-allow safe actions, require approval for risky ones."
                  done={false}
                  actionLabel="Set Policies"
                  href="/policies"
                />
              </div>
            </div>

            {/* Security Preview */}
            <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto">
              <div className="bg-surface-1 border border-border rounded-lg p-3 text-center">
                <p className="text-[18px] font-bold text-emerald-400 font-mono">1</p>
                <p className="text-[9px] text-text-tertiary mt-1">Policy Gate</p>
              </div>
              <div className="bg-surface-1 border border-border rounded-lg p-3 text-center">
                <p className="text-[18px] font-bold text-blue-400 font-mono">2</p>
                <p className="text-[9px] text-text-tertiary mt-1">Simulation</p>
              </div>
              <div className="bg-surface-1 border border-border rounded-lg p-3 text-center">
                <p className="text-[18px] font-bold text-purple-400 font-mono">3</p>
                <p className="text-[9px] text-text-tertiary mt-1">Secure Exec</p>
              </div>
            </div>

            <p className="text-center text-[10px] text-text-muted max-w-sm mx-auto">
              Every agent action flows through three layers of security. Agents declare intent — Wooblay executes safely. Credentials never touch the agent container.
            </p>
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
            <p className="text-[10px] text-text-tertiary uppercase tracking-wider mb-2">offline</p>
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
            <Link to="/audit" className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors">audit →</Link>
            <Link to="/policies" className="text-[10px] text-text-tertiary hover:text-text-secondary transition-colors">policies →</Link>
          </div>
        )}
      </div>
    </div></div>
  );
}

function SetupStep({
  number, title, description, done, action, actionLabel, href,
}: {
  number: number; title: string; description: string; done: boolean;
  action?: () => void; actionLabel: string; href?: string;
}) {
  const content = (
    <div className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${done ? 'opacity-50' : 'hover:bg-surface-2/50'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
        done ? 'bg-emerald-500/15 text-emerald-400' : 'bg-accent/10 text-accent'
      }`}>
        {done ? (
          <span className="text-[10px]">*</span>
        ) : (
          <span className="text-[10px] font-bold font-mono">{number}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-medium text-text-primary">{title}</p>
        <p className="text-[10px] text-text-tertiary mt-0.5">{description}</p>
      </div>
      {!done && (
        <span className="text-[10px] text-accent shrink-0 mt-0.5">{actionLabel} →</span>
      )}
    </div>
  );

  if (href && !action) {
    return <Link to={href}>{content}</Link>;
  }

  return (
    <button onClick={action} className="w-full text-left">
      {content}
    </button>
  );
}
