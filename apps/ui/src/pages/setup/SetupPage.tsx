/**
 * Setup — Connect your agent to Wooblay's security gate.
 * Card-based instance picker, SSE endpoint, config snippets, API keys.
 */

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Button } from '../../components/common/Button.tsx';
import { getApiKeys, createApiKey, revokeApiKey, getOrgPolicySettings, updateOrgPolicySettings, getInstances, createInstance, getMcpServers, type ApiKeyInfo, type ApiKeyCreated, type Instance } from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
const X_HANDLE_URL = 'https://x.com/wooblay';

function InstancePickerCard({ instance, selected, onClick }: { instance: Instance; selected: boolean; onClick: () => void }) {
  const { data: mcpServers } = useQuery({
    queryKey: ['mcp-servers', instance.id],
    queryFn: () => getMcpServers(instance.id),
    staleTime: 30_000,
  });

  const toolCount = mcpServers?.filter(s => s.enabled).length ?? 0;
  const isProxy = instance.instanceType === 'proxy';

  return (
    <button
      onClick={onClick}
      className={clsx(
        'text-left rounded-xl border p-4 transition-all w-full',
        selected
          ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
          : 'border-border bg-surface-0 hover:border-border-strong',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-sm font-semibold text-text-primary truncate">{instance.name}</span>
        <span className={clsx(
          'text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0',
          isProxy ? 'bg-violet-500/10 text-violet-400' : 'bg-blue-500/10 text-blue-400',
        )}>
          {isProxy ? 'Proxy' : 'Agent'}
        </span>
      </div>
      <div className="text-[10px] text-text-muted font-mono">
        {toolCount} tool{toolCount !== 1 ? 's' : ''}
      </div>
      {selected && (
        <div className="text-[9px] text-accent font-medium mt-1.5">selected</div>
      )}
    </button>
  );
}

type ConfigTab = 'claude' | 'cursor' | 'rest';

function ConnectionConfig({ sseEndpoint }: { sseEndpoint: string }) {
  const [tab, setTab] = useState<ConfigTab>('claude');
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(sseEndpoint);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const snippets: Record<ConfigTab, string> = {
    claude: JSON.stringify({
      mcpServers: {
        wooblay: {
          url: sseEndpoint,
          transport: "sse",
          headers: { Authorization: "Bearer wbl_ak_..." },
        },
      },
    }, null, 2),
    cursor: JSON.stringify({
      mcpServers: {
        wooblay: {
          url: sseEndpoint,
        },
      },
    }, null, 2),
    rest: `POST ${API_BASE}/api/gateway/execute
Authorization: Bearer wbl_ak_...

{
  "action": "mcp:tool-call",
  "toolName": "github-tools__create_pr",
  "args": { "title": "...", "base": "main" }
}`,
  };

  return (
    <div className="space-y-4">
      {/* SSE URL */}
      <div>
        <div className="text-[10px] text-text-muted uppercase tracking-wider font-mono mb-2">SSE Endpoint</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-surface-0 border border-border px-4 py-3 rounded-lg text-sm font-mono text-text-primary break-all select-all">
            {sseEndpoint}
          </code>
          <button
            onClick={copyUrl}
            className="shrink-0 px-4 py-3 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-xs font-mono font-medium transition-colors"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Config tabs */}
      <div className="bg-surface-1 border border-border rounded-xl overflow-hidden">
        <div className="flex border-b border-border">
          {(['claude', 'cursor', 'rest'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={clsx(
                'px-5 py-2.5 text-[11px] font-mono uppercase tracking-wider transition-colors',
                tab === t
                  ? 'bg-accent/10 text-accent font-medium border-b-2 border-accent'
                  : 'text-text-tertiary hover:text-text-secondary',
              )}
            >
              {t === 'claude' ? 'Claude Desktop' : t === 'cursor' ? 'Cursor' : 'REST API'}
            </button>
          ))}
        </div>
        <pre className="p-5 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
          {snippets[tab]}
        </pre>
      </div>
    </div>
  );
}

function DeployProxyInline() {
  const [name, setName] = useState('');
  const qc = useQueryClient();
  const { toast } = useToast();

  const createMut = useMutation({
    mutationFn: () => createInstance({ name, instanceType: 'proxy' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['instances'] });
      toast('MCP Proxy deployed — configure tools in its detail view', 'success');
      setName('');
    },
    onError: (err: any) => toast(`Deploy failed: ${err.message}`, 'error'),
  });

  return (
    <div className="bg-surface-0 rounded-lg border border-border p-5">
      <p className="text-sm text-text-secondary mb-3">Deploy an MCP Proxy to get your secure endpoint.</p>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="block text-[10px] text-text-muted mb-1">Proxy name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && createMut.mutate()}
            placeholder="e.g. my-firewall"
            className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50"
          />
        </div>
        <Button onClick={() => createMut.mutate()} disabled={!name.trim() || createMut.isPending}>
          {createMut.isPending ? 'Deploying…' : 'Deploy Proxy'}
        </Button>
      </div>
    </div>
  );
}

export function SetupPage() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys });
  const { data: orgSettings } = useQuery({ queryKey: ['org-settings'], queryFn: getOrgPolicySettings, staleTime: 60_000 });
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: getInstances });
  const platformMode = (orgSettings as any)?.platformMode ?? 'firewall';

  const [selectedId, setSelectedId] = useState<string>('');
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');

  useEffect(() => {
    if (instances.length === 1) {
      setSelectedId(instances[0].id);
    } else if (instances.length === 0) {
      setSelectedId('');
    }
  }, [instances]);

  const selected = instances.find((i: Instance) => i.id === selectedId) as Instance | undefined;
  const sseEndpoint = selected
    ? (selected.instanceType === 'proxy'
      ? (selected.endpoint || `${API_BASE}/mcp/${selected.id}`)
      : `${API_BASE}/mcp/${selected.id}`)
    : '';

  const unlockFullPlatformMut = useMutation({
    mutationFn: () => updateOrgPolicySettings({ platformMode: 'full', unlockPassword }),
    onSuccess: () => {
      setUnlockPassword('');
      qc.invalidateQueries({ queryKey: ['org-settings'] });
      toast('Full Platform mode enabled', 'success');
    },
    onError: (err: any) => {
      const msg = err?.body ? (() => { try { const o = JSON.parse(err.body); return o.detail || o.error; } catch { return err.message; } })() : err?.message;
      if (msg?.includes?.('not configured') || msg?.includes?.('Contact Wooblay')) {
        toast('Full Platform access is gated. Reach out on X for the unlock password.', 'error');
      } else {
        toast(msg?.includes?.('Incorrect') ? 'Incorrect platform password.' : 'Failed to unlock.', 'error');
      }
    },
  });

  const createKeyMut = useMutation({
    mutationFn: () => createApiKey({ name: newKeyName, expiresInDays: newKeyExpiry ? parseInt(newKeyExpiry) : undefined }),
    onSuccess: (data) => {
      setCreatedKey(data);
      setNewKeyName('');
      setNewKeyExpiry('');
      qc.invalidateQueries({ queryKey: ['api-keys'] });
      toast('API key created — copy it now, it won\'t be shown again', 'success');
    },
    onError: () => toast('Failed to create API key', 'error'),
  });

  const revokeKeyMut = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast('API key revoked', 'info'); },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Connect Your Agent</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Every tool call is policy-checked, simulated, and credentialed actions run in ephemeral containers.
        </p>
      </div>

      {/* ── HTTP API ─────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">HTTP API</h2>
        <p className="text-[10px] text-text-muted mb-3">
          Use the REST API directly for any integration. All three security layers apply.
        </p>
        <div className="mb-3">
          <div className="text-[10px] text-text-muted uppercase tracking-wider font-mono mb-1.5">Gateway Endpoint</div>
          <code className="block bg-surface-0 border border-border px-4 py-3 rounded-lg text-sm font-mono text-text-primary break-all select-all">
            {API_BASE}/api/gateway/execute
          </code>
        </div>
        <pre className="bg-surface-0 border border-border rounded-lg p-4 text-xs font-mono text-text-secondary overflow-x-auto whitespace-pre">
{`POST /api/gateway/execute
Authorization: Bearer wbl_ak_...
Content-Type: application/json

{
  "action": "exec:run",
  "toolName": "github-tools__create_pr",
  "args": { "title": "...", "base": "main" },
  "connectionIds": ["conn_id_here"]
}`}
        </pre>
      </div>

      {/* ── MCP Proxy Endpoint ─────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">MCP Proxy</h2>
        <p className="text-[10px] text-text-muted mb-3">
          Connect MCP-speaking agents (Claude Desktop, Cursor, custom) through the security gate.
        </p>

        {instances.length === 0 ? (
          <DeployProxyInline />
        ) : (
          <>
            {instances.length > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                {instances.map((inst: Instance) => (
                  <InstancePickerCard
                    key={inst.id}
                    instance={inst}
                    selected={inst.id === selectedId}
                    onClick={() => setSelectedId(inst.id)}
                  />
                ))}
              </div>
            )}
            {selected ? (
              <ConnectionConfig sseEndpoint={sseEndpoint} />
            ) : (
              <p className="text-sm text-text-muted text-center py-4">Select an instance above to see its MCP config.</p>
            )}
          </>
        )}
      </div>

      {/* ── Security Architecture ──────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Security Architecture</h2>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-surface-2/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-mono font-bold flex items-center justify-center">L1</span>
              <span className="text-[11px] font-medium text-text-primary">Policy Gate</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">
              Every tool call evaluated against dynamic rules. ALLOW / DENY / PENDING_APPROVAL.
            </p>
          </div>
          <div className="bg-surface-2/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono font-bold flex items-center justify-center">L2</span>
              <span className="text-[11px] font-medium text-text-primary">Simulation</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">
              Pre-execution sandbox. No network, no real credentials. Detects intent mismatch.
            </p>
          </div>
          <div className="bg-surface-2/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold flex items-center justify-center">L3</span>
              <span className="text-[11px] font-medium text-text-primary">Secure Execution</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">
              Ephemeral container — vault creds injected, tool executes, container destroyed.
            </p>
          </div>
        </div>
        <p className="text-[10px] text-text-muted border-t border-border pt-3">
          The agent never sees credentials. Only the ephemeral container — which lives for one tool call — has access.
        </p>
      </div>

      {/* ── API Keys ───────────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">API Keys</h2>

        {createdKey && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-4">
            <p className="text-[11px] font-medium text-emerald-400 mb-2">Copy now — won't be shown again</p>
            <div className="flex gap-2">
              <code className="flex-1 text-xs bg-black/30 rounded px-2 py-1.5 text-emerald-300 font-mono break-all select-all">
                {createdKey.key}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(createdKey.key); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
                className="shrink-0 px-2 py-1.5 text-[11px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded"
              >
                {copiedKey ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button onClick={() => setCreatedKey(null)} className="text-[10px] text-text-muted hover:text-text-secondary mt-1.5">Dismiss</button>
          </div>
        )}

        {apiKeys.length > 0 && (
          <div className="space-y-1.5 mb-4">
            {apiKeys.map((k: ApiKeyInfo) => (
              <div key={k.id} className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2">
                <span className="text-[11px] text-text-primary">{k.name}</span>
                <code className="text-[10px] text-text-muted font-mono">{k.prefix}...</code>
                <button onClick={() => revokeKeyMut.mutate(k.id)} className="text-[10px] text-red-400/70 hover:text-red-400">Revoke</button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="block text-[10px] text-text-muted mb-0.5">Name</label>
            <input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="e.g. GPT, Claude, CI"
              className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <div className="w-24">
            <label className="block text-[10px] text-text-muted mb-0.5">Expires (days)</label>
            <input
              value={newKeyExpiry}
              onChange={(e) => setNewKeyExpiry(e.target.value)}
              placeholder="—"
              type="number"
              min="1"
              className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
          <Button size="sm" onClick={() => newKeyName && createKeyMut.mutate()} disabled={!newKeyName || createKeyMut.isPending}>
            Create key
          </Button>
        </div>
      </div>

      {/* ── Request full platform access ──────────────────────────────── */}
      {platformMode === 'firewall' && (
        <div className="bg-surface-1 border border-purple-500/20 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-1">Request full platform access</h2>
          <p className="text-[11px] text-text-secondary mb-3">
            Full platform unlocks hosted agents, sensors, and orchestration. Same security, more capabilities.
          </p>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <div className="min-w-[180px]">
              <label className="block text-[10px] text-text-muted mb-0.5">Platform password</label>
              <input
                type="password"
                value={unlockPassword}
                onChange={(e) => setUnlockPassword(e.target.value)}
                placeholder="From Wooblay"
                className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
            <Button
              size="sm"
              onClick={() => unlockPassword && unlockFullPlatformMut.mutate()}
              disabled={!unlockPassword || unlockFullPlatformMut.isPending}
            >
              {unlockFullPlatformMut.isPending ? 'Unlocking\u2026' : 'Unlock full platform'}
            </Button>
          </div>
          <p className="text-[10px] text-text-muted">
            Don't have the password?{' '}
            <a href={X_HANDLE_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Reach out on X
            </a>
            {' '}\u2014 we'll get you set up.
          </p>
        </div>
      )}
    </div>
  );
}
