/**
 * Instances — Deploy, configure, and manage agent instances.
 * 3-step deploy wizard. Instance cards with status, actions, and loading states.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  getInstances,
  createInstance,
  startInstance,
  stopInstance,
  restartInstance,
  deleteInstance,
  updateInstance,
  getInstanceLogs,
  getAgentContainerState,
} from '../../api/client.ts';
import type { Instance, CreateInstanceRequest } from '../../api/client.ts';
import { Button } from '../../components/common/Button.tsx';
import { StatusDot } from '../../components/common/StatusDot.tsx';
import { EditableName } from '../../components/common/EditableName.tsx';
import { ConfirmDialog } from '../../components/common/ConfirmDialog.tsx';
import { useToast } from '../../components/common/Toast.tsx';

// ── Deploy Wizard ─────────────────────────────────────────────────────────────

interface WizardData {
  name: string;
  model: string;
  anthropicApiKey: string;
  githubToken: string;
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramAllowedUsers: string;
}

const POPULAR_MODELS: { id: string; label: string; tier: 'flagship' | 'standard' | 'fast' }[] = [
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
          className="flex-1 bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
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
        className="flex-1 bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
      >
        {POPULAR_MODELS.map((m) => (
          <option key={m.id} value={m.id}>{m.label} ({m.tier})</option>
        ))}
      </select>
      <button type="button" onClick={() => { setShowCustom(true); onChange(''); }} className="text-[10px] text-text-muted hover:text-text-secondary whitespace-nowrap">custom</button>
    </div>
  );
}


function DeployWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [instanceType, setInstanceType] = useState<'agent' | 'proxy' | null>(null);
  const [step, setStep] = useState(1);
  const [data, setData] = useState<WizardData>({
    name: '',
    model: POPULAR_MODELS[0].id,
    anthropicApiKey: '',
    githubToken: '',
    telegramEnabled: false,
    telegramBotToken: '',
    telegramAllowedUsers: '',
  });
  const [proxyName, setProxyName] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();

  const reset = () => {
    setInstanceType(null);
    setStep(1);
    setProxyName('');
    setData({ name: '', model: POPULAR_MODELS[0].id, anthropicApiKey: '', githubToken: '', telegramEnabled: false, telegramBotToken: '', telegramAllowedUsers: '' });
  };

  const createMut = useMutation({
    mutationFn: (body: CreateInstanceRequest) => createInstance(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] });
      toast(instanceType === 'proxy' ? 'MCP Proxy created — configure tools in the detail view' : 'Instance deployed successfully', 'success');
      onClose();
      reset();
    },
    onError: (err) => toast(`Deploy failed: ${err.message}`, 'error'),
  });

  if (!open) return null;

  const deployAgent = () => {
    createMut.mutate({
      name: data.name,
      instanceType: 'agent',
      model: data.model,
      anthropicApiKey: data.anthropicApiKey,
      githubToken: data.githubToken || undefined,
      telegramEnabled: data.telegramEnabled,
      telegramBotToken: data.telegramBotToken || undefined,
      telegramAllowedUsers: data.telegramAllowedUsers || undefined,
    });
  };

  const deployProxy = () => {
    createMut.mutate({ name: proxyName, instanceType: 'proxy' });
  };

  const handleClose = () => { onClose(); reset(); };

  // Skip type selector — go straight to proxy flow
  if (!instanceType) {
    setInstanceType('proxy');
  }

  // Proxy flow — just name
  if (instanceType === 'proxy') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={handleClose} />
        <div className="relative bg-surface-1 border border-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl animate-float-up">
          <h2 className="text-base font-semibold text-text-primary mb-1">Create MCP Proxy</h2>
          <p className="text-xs text-text-muted mb-5">
            A standalone proxy that gates MCP tool calls through your firewall. Configure MCP servers and vault credentials after creation.
          </p>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Proxy Name</label>
              <input
                value={proxyName}
                onChange={(e) => setProxyName(e.target.value)}
                placeholder="e.g. my-mcp-proxy"
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                autoFocus
              />
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setInstanceType(null)}>Back</Button>
              <Button onClick={deployProxy} disabled={!proxyName.trim() || createMut.isPending}>
                {createMut.isPending ? 'Creating...' : 'Create Proxy'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Agent flow — existing 3-step wizard
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative bg-surface-1 border border-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl animate-float-up">
        <div className="flex items-center gap-3 mb-6">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={clsx(
                'h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold',
                s === step ? 'bg-accent text-white' : s < step ? 'bg-emerald-600 text-white' : 'bg-surface-3 text-text-muted',
              )}>
                {s < step ? '✓' : s}
              </div>
              {s < 3 && <div className={clsx('w-8 h-px', s < step ? 'bg-emerald-600' : 'bg-surface-3')} />}
            </div>
          ))}
          <span className="ml-3 text-xs text-text-muted">
            {step === 1 ? 'Basics' : step === 2 ? 'Channels' : 'Review'}
          </span>
        </div>

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Configure Agent</h2>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Instance Name</label>
              <input
                value={data.name}
                onChange={(e) => setData({ ...data, name: e.target.value })}
                placeholder="e.g. Code Review Agent"
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Model</label>
              <ModelSelector value={data.model} onChange={(v) => setData({ ...data, model: v })} />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">Anthropic API Key</label>
              <input
                type="password"
                value={data.anthropicApiKey}
                onChange={(e) => setData({ ...data, anthropicApiKey: e.target.value })}
                placeholder="sk-ant-..."
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-text-secondary mb-1 block">GitHub Token (optional)</label>
              <input
                type="password"
                value={data.githubToken}
                onChange={(e) => setData({ ...data, githubToken: e.target.value })}
                placeholder="ghp_... or github_pat_..."
                className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
              />
              <p className="text-[10px] text-text-muted mt-1">
                Allows the agent to interact with GitHub (create PRs, commit code, etc.)
              </p>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setInstanceType(null)}>Back</Button>
              <Button onClick={() => setStep(2)} disabled={!data.name.trim()}>
                Next
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Channels (Optional)</h2>
            <p className="text-xs text-text-secondary">Connect Telegram to interact with this agent via chat.</p>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={data.telegramEnabled}
                onChange={(e) => setData({ ...data, telegramEnabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Enable Telegram</span>
            </label>
            {data.telegramEnabled && (
              <>
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Bot Token</label>
                  <input
                    type="password"
                    value={data.telegramBotToken}
                    onChange={(e) => setData({ ...data, telegramBotToken: e.target.value })}
                    placeholder="123456:ABC-..."
                    className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Allowed User IDs (comma-separated)</label>
                  <input
                    value={data.telegramAllowedUsers}
                    onChange={(e) => setData({ ...data, telegramAllowedUsers: e.target.value })}
                    placeholder="123456789, 987654321"
                    className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                  />
                  <p className="text-[10px] text-text-muted mt-1">Get your ID by messaging @userinfobot on Telegram</p>
                </div>
              </>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={() => setStep(3)}>Next</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Review & Deploy</h2>
            <div className="bg-surface-0 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-text-muted">Name</span>
                <span className="text-text-primary font-medium">{data.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Model</span>
                <span className="text-text-primary font-mono text-xs">{data.model}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">API Key</span>
                <span className="text-text-primary font-mono text-xs">
                  {data.anthropicApiKey ? '••••' + data.anthropicApiKey.slice(-4) : 'Not set'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">GitHub</span>
                <span className="text-text-primary font-mono text-xs">
                  {data.githubToken ? '••••' + data.githubToken.slice(-4) : 'Not set'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Telegram</span>
                <span className="text-text-primary">{data.telegramEnabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Back</Button>
              <Button onClick={deployAgent} disabled={createMut.isPending}>
                {createMut.isPending ? 'Deploying...' : 'Deploy Agent'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Configure Modal ───────────────────────────────────────────────────────────

function ConfigureModal({ instance, open, onClose }: { instance: Instance; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  // Parse existing config
  const existingConfig = instance.configJson ? JSON.parse(instance.configJson) : {};

  const [telegramEnabled, setTelegramEnabled] = useState(existingConfig.telegramEnabled ?? !!instance.telegramBot);
  const [telegramBotToken, setTelegramBotToken] = useState('');
  const [telegramAllowedUsers, setTelegramAllowedUsers] = useState(existingConfig.telegramAllowedUsers ?? '');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [model, setModel] = useState(instance.model || POPULAR_MODELS[0].id);

  const updateMut = useMutation({
    mutationFn: (body: Partial<CreateInstanceRequest>) => updateInstance(instance.id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] });
      toast('Instance updated — restarting with new config', 'success');
      onClose();
    },
    onError: (err) => toast(`Update failed: ${err.message}`, 'error'),
  });

  if (!open) return null;

  const save = () => {
    const body: Partial<CreateInstanceRequest> = { model };
    if (telegramEnabled) {
      body.telegramEnabled = true;
      if (telegramBotToken.trim()) body.telegramBotToken = telegramBotToken.trim();
      if (telegramAllowedUsers.trim()) body.telegramAllowedUsers = telegramAllowedUsers.trim();
    } else {
      body.telegramEnabled = false;
    }
    if (anthropicApiKey.trim()) body.anthropicApiKey = anthropicApiKey.trim();
    if (githubToken.trim()) body.githubToken = githubToken.trim();
    updateMut.mutate(body);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-void/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-surface-1 border border-border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl animate-float-up">
        <h2 className="text-base font-semibold text-text-primary mb-4">Configure: {instance.name}</h2>

        <div className="space-y-4">
          {/* Model */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Model</label>
            <ModelSelector value={model} onChange={setModel} />
          </div>

          {/* API Key */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">Anthropic API Key</label>
            <input
              type="password"
              value={anthropicApiKey}
              onChange={(e) => setAnthropicApiKey(e.target.value)}
              placeholder={existingConfig.anthropicApiKey === '***SET***' ? 'Already set — enter to change' : 'sk-ant-...'}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
            />
          </div>

          {/* GitHub Token */}
          <div>
            <label className="text-xs text-text-secondary mb-1 block">GitHub Token</label>
            <input
              type="password"
              value={githubToken}
              onChange={(e) => setGithubToken(e.target.value)}
              placeholder={instance.githubPat ? 'Already set — enter to change' : 'ghp_... or github_pat_...'}
              className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
            />
            <p className="text-[10px] text-text-muted mt-1">
              Allows the agent to create PRs, commit code, etc.
            </p>
          </div>

          {/* Telegram */}
          <div className="pt-2 border-t border-border">
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={telegramEnabled}
                onChange={(e) => setTelegramEnabled(e.target.checked)}
                className="rounded"
              />
              <span className="text-sm text-text-primary">Enable Telegram</span>
              {instance.telegramBot && (
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full">Active</span>
              )}
            </label>

            {telegramEnabled && (
              <div className="space-y-3 pl-7">
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Bot Token</label>
                  <input
                    type="password"
                    value={telegramBotToken}
                    onChange={(e) => setTelegramBotToken(e.target.value)}
                    placeholder={instance.telegramBot ? 'Already set — enter to change' : '123456:ABC-...'}
                    className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-text-secondary mb-1 block">Allowed User IDs (comma-separated)</label>
                  <input
                    value={telegramAllowedUsers}
                    onChange={(e) => setTelegramAllowedUsers(e.target.value)}
                    placeholder="123456789, 987654321"
                    className="w-full bg-surface-0 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
                  />
                  <p className="text-[10px] text-text-muted mt-1">Get your ID by messaging @userinfobot on Telegram</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-between pt-6">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={updateMut.isPending}>
            {updateMut.isPending ? 'Saving...' : 'Save & Restart'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Instance Card ─────────────────────────────────────────────────────────────

function InstanceCard({ instance }: { instance: Instance }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);

  const isProxy = instance.instanceType === 'proxy';

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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['instances'] });
      toast('Instance deleted', 'info');
    },
    onError: (err: Error) => toast(err.message, 'error'),
  });
  const renameMut = useMutation({
    mutationFn: (name: string) => updateInstance(instance.id, { name }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['instances'] }),
  });

  const anyLoading = startMut.isPending || stopMut.isPending || restartMut.isPending || deleteMut.isPending;
  const containerState = getAgentContainerState(instance, { startPending: startMut.isPending, stopPending: stopMut.isPending });
  const statusForDot = containerState === 'offline' ? 'stopped' : containerState === 'online' ? 'running' : containerState;

  const loadLogs = async () => {
    try {
      const res = await getInstanceLogs(instance.id, 100);
      setLogs(res.logs);
    } catch { setLogs('Failed to load logs'); }
  };

  return (
    <>
      <div className="rounded-xl border border-border bg-surface-1 p-5 hover:border-border-strong transition-colors">
        <div className="flex items-center gap-3 mb-2">
          <EditableName
            value={instance.name}
            onSave={(name) => renameMut.mutate(name)}
            className="text-sm font-semibold text-text-primary"
          />
          <span className={clsx(
            'text-[10px] px-2 py-0.5 rounded-full font-medium',
            isProxy
              ? 'bg-violet-500/10 text-violet-400'
              : 'bg-blue-500/10 text-blue-400',
          )}>
            {isProxy ? 'Proxy' : 'Agent'}
          </span>
          <StatusDot status={statusForDot} showLabel />
          {!isProxy && instance.telegramBot && (
            <span className="text-[10px] bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full">TG</span>
          )}
          {!isProxy && instance.githubPat && (
            <span className="text-[10px] bg-purple-500/10 text-purple-400 px-2 py-0.5 rounded-full">GH</span>
          )}
          <span className="ml-auto text-[11px] text-text-muted font-mono">
            {isProxy ? 'mcp-proxy' : (instance.model || 'openclaw')}
          </span>
        </div>

        <div className="text-xs text-text-muted mb-4">
          Created {new Date(instance.createdAt).toLocaleDateString()}
          {isProxy && instance.endpoint && (
            <> · <span className="font-mono text-text-secondary">{instance.endpoint}</span></>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {containerState === 'offline' && (
            <Button size="xs" onClick={() => startMut.mutate()} disabled={anyLoading}>
              {startMut.isPending ? 'Starting…' : 'Start'}
            </Button>
          )}
          {containerState !== 'offline' && (
            <>
              <Button size="xs" variant="secondary" onClick={() => restartMut.mutate()} disabled={anyLoading}>
                {restartMut.isPending ? 'Restarting...' : 'Restart'}
              </Button>
              <Button size="xs" variant="secondary" onClick={() => stopMut.mutate()} disabled={anyLoading}>
                {stopMut.isPending ? 'Stopping...' : 'Stop'}
              </Button>
            </>
          )}
          {!isProxy && (
            <Button size="xs" variant="ghost" onClick={() => setConfigOpen(true)}>
              Configure
            </Button>
          )}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => { setExpanded(!expanded); if (!expanded) loadLogs(); }}
          >
            {expanded ? 'Collapse' : 'Logs'}
          </Button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-[11px] text-red-400/60 hover:text-red-400 ml-auto transition-colors"
            disabled={anyLoading}
          >
            Delete
          </button>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t border-border space-y-3 animate-slide-in-up">
            <div>
              <h4 className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Configuration</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {isProxy ? (
                  <>
                    <span className="text-text-muted">Type</span>
                    <span className="text-text-secondary">MCP Proxy</span>
                    <span className="text-text-muted">SSE Endpoint</span>
                    <span className="text-text-secondary font-mono text-[10px] break-all">{instance.endpoint || '—'}</span>
                  </>
                ) : (
                  <>
                    <span className="text-text-muted">Model</span>
                    <span className="text-text-secondary font-mono">{instance.model}</span>
                    <span className="text-text-muted">Runtime</span>
                    <span className="text-text-secondary">{instance.agentRuntime}</span>
                    <span className="text-text-muted">Telegram</span>
                    <span className="text-text-secondary">{instance.telegramBot ? 'Enabled' : 'Disabled'}</span>
                  </>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-[10px] text-text-muted uppercase tracking-wider">Logs</h4>
                <button onClick={loadLogs} className="text-[10px] text-accent-bright hover:underline">
                  Refresh
                </button>
              </div>
              <pre className="text-[10px] font-mono text-text-muted bg-surface-0 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                {logs ?? 'Loading...'}
              </pre>
            </div>
          </div>
        )}
      </div>

      {!isProxy && (
        <ConfigureModal instance={instance} open={configOpen} onClose={() => setConfigOpen(false)} />
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={isProxy ? 'Delete Proxy' : 'Delete Instance'}
        message={`This will permanently stop and remove "${instance.name}". This cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={() => { deleteMut.mutate(); setConfirmDelete(false); }}
        onCancel={() => setConfirmDelete(false)}
        loading={deleteMut.isPending}
      />
    </>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function InstancesPage() {
  const { data: instances, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: getInstances,
    refetchInterval: 5_000,
  });
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-text-primary">Instances</h1>
          <p className="text-xs text-text-muted mt-1">Hosted agents and MCP proxy endpoints</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>Deploy New</Button>
      </div>

      {isLoading && <div className="text-sm text-text-muted py-12 text-center">Loading...</div>}

      {!isLoading && (!instances || instances.length === 0) && (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="h-16 w-16 rounded-2xl bg-surface-2 border border-border flex items-center justify-center text-2xl mb-6">
            ◎
          </div>
          <h2 className="text-base font-semibold text-text-primary mb-2">No instances yet</h2>
          <p className="text-sm text-text-secondary mb-6 max-w-md">
            Deploy a hosted agent or create an MCP proxy to secure your external tools.
          </p>
          <Button onClick={() => setWizardOpen(true)}>Create Instance</Button>
        </div>
      )}

      {/* Instance list */}
      <div className="space-y-3">
        {instances?.map((inst) => (
          <InstanceCard key={inst.id} instance={inst} />
        ))}
      </div>

      <DeployWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
