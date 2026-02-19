/**
 * Gateway — single guided page for the Wooblay firewall.
 * Flow: API Keys → Your Firewall (status + connect) → MCP Tools → Security → Unlock
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Button } from '../../components/common/Button.tsx';
import {
  getApiKeys, createApiKey, revokeApiKey,
  getInstances, createInstance, deleteInstance,
  getMcpServers, addMcpServer, updateMcpServer, deleteMcpServer,
  getConnections, getStats,
  type ApiKeyInfo, type ApiKeyCreated, type Instance, type McpServerConfig, type CreateMcpServerRequest,
} from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

const API_BASE = import.meta.env.VITE_API_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');

// ── MCP Server Catalog ──────────────────────────────────────────────────────

const MCP_CATALOG: { name: string; label: string; desc: string; transport: 'stdio' | 'sse'; source: string }[] = [
  { name: 'github', label: 'GitHub', desc: 'Repos, PRs, issues, files', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-github' },
  { name: 'filesystem', label: 'Filesystem', desc: 'Read, write, search files', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-filesystem /' },
  { name: 'brave-search', label: 'Brave Search', desc: 'Web search', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-brave-search' },
  { name: 'slack', label: 'Slack', desc: 'Messages, channels, users', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-slack' },
  { name: 'postgres', label: 'PostgreSQL', desc: 'Query databases', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-postgres' },
  { name: 'gdrive', label: 'Google Drive', desc: 'Files, search, share', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-gdrive' },
  { name: 'puppeteer', label: 'Puppeteer', desc: 'Browser automation', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-puppeteer' },
  { name: 'memory', label: 'Memory', desc: 'Persistent knowledge graph', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-memory' },
  { name: 'fetch', label: 'Fetch', desc: 'HTTP requests', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-fetch' },
  { name: 'sequential-thinking', label: 'Thinking', desc: 'Step-by-step reasoning', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-sequential-thinking' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
      className={clsx('shrink-0 text-[11px] font-mono font-medium transition-colors', className ?? 'px-3 py-1.5 rounded bg-accent/10 hover:bg-accent/20 text-accent')}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Section 1: API Keys ─────────────────────────────────────────────────────

function ApiKeysSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys });
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState('');
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const createMut = useMutation({
    mutationFn: () => createApiKey({ name, expiresInDays: expiry ? parseInt(expiry) : undefined }),
    onSuccess: (data) => { setCreated(data); setName(''); setExpiry(''); qc.invalidateQueries({ queryKey: ['api-keys'] }); toast('API key created — copy it now', 'success'); },
    onError: () => toast('Failed to create API key', 'error'),
  });

  const revokeMut = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['api-keys'] }); toast('Revoked', 'info'); },
  });

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-text-primary">API Keys</h2>
        <span className="text-[10px] text-text-muted font-mono">step 1</span>
      </div>

      {created && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-3">
          <p className="text-[11px] font-medium text-emerald-400 mb-2">Copy now — won't be shown again</p>
          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-black/30 rounded px-2 py-1.5 text-emerald-300 font-mono break-all select-all">{created.key}</code>
            <button
              onClick={() => { navigator.clipboard.writeText(created.key); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); }}
              className="shrink-0 px-2 py-1.5 text-[11px] bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 rounded"
            >{copiedKey ? 'Copied' : 'Copy'}</button>
          </div>
          <button onClick={() => setCreated(null)} className="text-[10px] text-text-muted hover:text-text-secondary mt-1.5">Dismiss</button>
        </div>
      )}

      {apiKeys.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {apiKeys.map((k: ApiKeyInfo) => (
            <div key={k.id} className="flex items-center justify-between bg-surface-2 rounded-lg px-3 py-2">
              <span className="text-[11px] text-text-primary font-medium">{k.name}</span>
              <code className="text-[10px] text-text-muted font-mono">{k.prefix}...</code>
              <button onClick={() => revokeMut.mutate(k.id)} className="text-[10px] text-red-400/60 hover:text-red-400">Revoke</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1 min-w-[120px]">
          <label className="block text-[10px] text-text-muted mb-0.5">Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. claude, cursor"
            onKeyDown={(e) => e.key === 'Enter' && name && createMut.mutate()}
            className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
        </div>
        <div className="w-20">
          <label className="block text-[10px] text-text-muted mb-0.5">Expiry (days)</label>
          <input value={expiry} onChange={(e) => setExpiry(e.target.value)} placeholder="—" type="number" min="1"
            className="w-full bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[12px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent" />
        </div>
        <Button size="sm" onClick={() => name && createMut.mutate()} disabled={!name || createMut.isPending}>
          {createMut.isPending ? 'Creating...' : 'Create key'}
        </Button>
      </div>

      {apiKeys.length === 0 && !created && (
        <p className="text-[10px] text-text-muted mt-2">You need an API key to authenticate. Create one to get started.</p>
      )}
    </div>
  );
}

// ── Section 2: Your Firewall ────────────────────────────────────────────────

type ConnectTab = 'claude' | 'cursor' | 'http';

function FirewallSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: getInstances });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 10_000 });

  const proxy = instances.find((i: Instance) => i.instanceType === 'proxy');
  const sseEndpoint = proxy ? (proxy.endpoint || `${API_BASE}/mcp/${proxy.id}`) : '';

  const [proxyName, setProxyName] = useState('');
  const [tab, setTab] = useState<ConnectTab>('claude');

  const [confirmDelete, setConfirmDelete] = useState(false);

  const deployMut = useMutation({
    mutationFn: () => createInstance({ name: proxyName, instanceType: 'proxy' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['instances'] }); toast('Firewall deployed', 'success'); setProxyName(''); },
    onError: (err: any) => toast(`Failed: ${err.message}`, 'error'),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteInstance(proxy!.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['instances'] }); toast('Proxy deleted', 'info'); setConfirmDelete(false); },
    onError: (err: any) => toast(`Failed: ${err.message}`, 'error'),
  });

  const snippets: Record<ConnectTab, string> = {
    claude: JSON.stringify({
      mcpServers: {
        wooblay: {
          url: sseEndpoint || 'https://your-domain.com/mcp/...',
          transport: 'sse',
          headers: { Authorization: 'Bearer wbl_ak_...' },
        },
      },
    }, null, 2),
    cursor: JSON.stringify({
      mcpServers: {
        wooblay: {
          url: sseEndpoint || 'https://your-domain.com/mcp/...',
        },
      },
    }, null, 2),
    http: `curl -X POST ${API_BASE}/api/gateway/execute \\
  -H "Authorization: Bearer wbl_ak_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "mcp:tool-call",
    "toolName": "github__create_issue",
    "args": { "title": "Bug fix", "repo": "org/repo" }
  }'`,
  };

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-text-primary">Your Firewall</h2>
        <span className="text-[10px] text-text-muted font-mono">step 2</span>
      </div>

      {!proxy ? (
        <>
          <p className="text-[10px] text-text-muted mb-3">Deploy a firewall proxy to get your secure endpoint.</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <input value={proxyName} onChange={(e) => setProxyName(e.target.value)} placeholder="Name (e.g. production)"
                onKeyDown={(e) => e.key === 'Enter' && proxyName.trim() && deployMut.mutate()}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50" />
            </div>
            <Button onClick={() => deployMut.mutate()} disabled={!proxyName.trim() || deployMut.isPending}>
              {deployMut.isPending ? 'Deploying...' : 'Deploy'}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Status + stats row */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <span className={clsx('w-2 h-2 rounded-full', proxy.status === 'running' ? 'bg-emerald-400' : proxy.status === 'error' ? 'bg-red-400' : 'bg-amber-400')} />
              <span className="text-xs text-text-secondary font-mono">{proxy.name}</span>
              <span className="text-[9px] text-text-muted font-mono">{proxy.status}</span>
            </div>
            {stats && (
              <div className="flex items-center gap-3 ml-auto text-[10px] font-mono">
                <span className="text-text-secondary">{stats.totalToolCalls} calls</span>
                {(stats.byDecision?.DENY ?? 0) > 0 && <span className="text-red-400">{stats.byDecision.DENY} blocked</span>}
                {stats.pendingApprovals > 0 && <span className="text-amber-400">{stats.pendingApprovals} pending</span>}
              </div>
            )}
            {!confirmDelete ? (
              <button onClick={() => setConfirmDelete(true)} className="text-[9px] text-text-muted hover:text-red-400 font-mono transition-colors ml-2">delete</button>
            ) : (
              <div className="flex items-center gap-1 ml-2">
                <button onClick={() => deleteMut.mutate()} disabled={deleteMut.isPending}
                  className="text-[9px] text-red-400 font-mono font-medium hover:text-red-300">{deleteMut.isPending ? '...' : 'confirm'}</button>
                <button onClick={() => setConfirmDelete(false)} className="text-[9px] text-text-muted font-mono">cancel</button>
              </div>
            )}
          </div>

          {/* Endpoint */}
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-surface-0 border border-border px-3 py-2.5 rounded-lg text-[12px] font-mono text-text-primary break-all select-all">
                {sseEndpoint}
              </code>
              <CopyButton text={sseEndpoint} />
            </div>
          </div>

          {/* Connect tabs */}
          <div className="bg-surface-0 border border-border rounded-xl overflow-hidden">
            <div className="flex border-b border-border">
              {([['claude', 'Claude Desktop'], ['cursor', 'Cursor'], ['http', 'HTTP / cURL']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setTab(key as ConnectTab)}
                  className={clsx(
                    'flex-1 px-4 py-2 text-[11px] font-mono transition-colors',
                    tab === key ? 'bg-accent/10 text-accent font-medium border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary',
                  )}>
                  {label}
                </button>
              ))}
            </div>
            <pre className="p-4 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed">{snippets[tab]}</pre>
          </div>
        </>
      )}
    </div>
  );
}

// ── Section 3: MCP Tools ────────────────────────────────────────────────────

function McpToolsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: getInstances });
  const proxy = instances.find((i: Instance) => i.instanceType === 'proxy');

  const { data: servers = [] } = useQuery({
    queryKey: ['mcp-servers', proxy?.id],
    queryFn: () => getMcpServers(proxy!.id),
    enabled: !!proxy,
  });

  const { data: connections = [] } = useQuery({ queryKey: ['connections'], queryFn: getConnections });
  const activeConns = connections.filter((c: any) => c.status === 'active');

  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customTransport, setCustomTransport] = useState<'stdio' | 'sse'>('stdio');
  const [customSource, setCustomSource] = useState('');
  const [selectedConnIds, setSelectedConnIds] = useState<string[]>([]);

  const addMut = useMutation({
    mutationFn: (config: CreateMcpServerRequest) => addMcpServer(proxy!.id, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', proxy?.id] });
      toast('Tool server added', 'success');
      setShowCustom(false);
      setCustomName('');
      setCustomSource('');
      setSelectedConnIds([]);
    },
    onError: (err: any) => toast(`Failed: ${err?.body ?? err.message}`, 'error'),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateMcpServer(proxy!.id, id, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers', proxy?.id] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => deleteMcpServer(proxy!.id, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-servers', proxy?.id] }); toast('Removed', 'info'); },
  });

  const toggleConn = (id: string) => setSelectedConnIds(prev => prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]);

  const addFromCatalog = (item: typeof MCP_CATALOG[number]) => {
    if (!proxy) return;
    const alreadyAdded = servers.some((s: McpServerConfig) => s.name === item.name);
    if (alreadyAdded) { toast(`${item.label} is already added`, 'info'); return; }
    addMut.mutate({ name: item.name, transport: item.transport as 'stdio' | 'sse', source: item.source });
  };

  const handleCustomSubmit = () => {
    if (!customName.trim() || !customSource.trim()) return;
    addMut.mutate({
      name: customName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      transport: customTransport,
      source: customSource.trim(),
      connectionIds: selectedConnIds.length > 0 ? selectedConnIds : undefined,
    });
  };

  if (!proxy) return null;

  const configuredNames = new Set(servers.map((s: McpServerConfig) => s.name));

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-text-primary">MCP Tools</h2>
        <span className="text-[10px] text-text-muted font-mono">step 3</span>
      </div>
      <p className="text-[10px] text-text-muted mb-4">
        Add MCP tool servers to your firewall. Every tool call is policy-checked. Credentialed tools run in ephemeral containers.
      </p>

      {/* Catalog grid */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {MCP_CATALOG.map((item) => {
          const added = configuredNames.has(item.name);
          return (
            <button
              key={item.name}
              onClick={() => !added && addFromCatalog(item)}
              disabled={added || addMut.isPending}
              className={clsx(
                'text-left rounded-lg border p-3 transition-all',
                added
                  ? 'border-emerald-500/30 bg-emerald-500/5 opacity-70'
                  : 'border-border bg-surface-0 hover:border-accent/40 hover:bg-accent/5',
              )}
            >
              <div className="text-[11px] font-medium text-text-primary mb-0.5">{item.label}</div>
              <div className="text-[9px] text-text-muted leading-snug">{item.desc}</div>
              {added && <div className="text-[8px] text-emerald-400 font-medium mt-1">added</div>}
            </button>
          );
        })}
      </div>

      {/* Custom server entry */}
      {!showCustom ? (
        <button onClick={() => setShowCustom(true)}
          className="text-[11px] text-accent hover:text-accent-bright font-mono transition-colors">
          + add custom server
        </button>
      ) : (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-surface-0/50 mb-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Name</label>
              <input value={customName} onChange={(e) => setCustomName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} placeholder="my-server"
                className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none" />
            </div>
            <div className="w-20">
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">Transport</label>
              <select value={customTransport} onChange={(e) => setCustomTransport(e.target.value as 'stdio' | 'sse')}
                className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-[11px] font-mono text-text-primary outline-none">
                <option value="stdio">stdio</option>
                <option value="sse">SSE</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">
              {customTransport === 'stdio' ? 'Command' : 'SSE URL'}
            </label>
            <input value={customSource} onChange={(e) => setCustomSource(e.target.value)}
              placeholder={customTransport === 'stdio' ? 'npx -y @org/server-name' : 'https://mcp.example.com/sse'}
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none" />
          </div>

          {activeConns.length > 0 && (
            <div>
              <label className="text-[9px] text-text-muted font-mono uppercase block mb-1">
                Vault Credentials <span className="normal-case text-text-muted">(optional — enables L3)</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {activeConns.map((c: any) => (
                  <button key={c.id} type="button" onClick={() => toggleConn(c.id)}
                    className={clsx(
                      'px-2.5 py-1 rounded text-[10px] font-mono transition-colors border',
                      selectedConnIds.includes(c.id) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-border text-text-secondary hover:bg-surface-3',
                    )}>
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowCustom(false); setSelectedConnIds([]); }}
              className="px-3 py-1.5 text-[10px] font-mono text-text-secondary hover:text-text-primary">Cancel</button>
            <button onClick={handleCustomSubmit} disabled={!customName.trim() || !customSource.trim() || addMut.isPending}
              className="px-4 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">
              {addMut.isPending ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Configured servers list */}
      {servers.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <div className="text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">Configured</div>
          {servers.map((s: McpServerConfig) => (
            <div key={s.id} className={clsx('flex items-center justify-between bg-surface-0 border rounded-lg px-3 py-2 group', s.enabled ? 'border-border' : 'border-border opacity-50')}>
              <div className="flex items-center gap-2.5">
                <button onClick={() => toggleMut.mutate({ id: s.id, enabled: !s.enabled })}
                  className={clsx('relative h-4 w-7 shrink-0 rounded-full transition-colors', s.enabled ? 'bg-accent' : 'bg-surface-3')}>
                  <span className={clsx('absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform duration-200', s.enabled ? 'translate-x-3' : 'translate-x-0')} />
                </button>
                <span className="text-[11px] font-mono text-text-primary">{s.name}</span>
                <span className="text-[9px] text-text-muted">{s.transport}</span>
                {s.connectionIds && s.connectionIds.length > 0 && (
                  <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono">L3</span>
                )}
              </div>
              <button onClick={() => removeMut.mutate(s.id)}
                className="text-[10px] text-red-400/0 group-hover:text-red-400/60 hover:!text-red-400 transition-colors font-mono">
                remove
              </button>
            </div>
          ))}
        </div>
      )}

      {servers.length === 0 && (
        <p className="text-[10px] text-text-muted mt-3">
          No tools configured yet. Pick from the catalog above or add a custom server.
        </p>
      )}
    </div>
  );
}

// ── Section 4: Security Architecture (condensed) ────────────────────────────

function SecuritySection() {
  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <h2 className="text-sm font-semibold text-text-primary mb-3">How It Works</h2>
      <div className="grid grid-cols-3 gap-2">
        {[
          { id: 'L1', color: 'blue', title: 'Policy Gate', desc: 'Every tool call checked against your rules. Allow, deny, or require approval.' },
          { id: 'L2', color: 'amber', title: 'Simulation', desc: 'Sandboxed pre-execution. No network, no credentials. Catches intent mismatch.' },
          { id: 'L3', color: 'emerald', title: 'Secure Exec', desc: 'Ephemeral container — vault creds injected, tool runs, container destroyed.' },
        ].map(({ id, color, title, desc }) => (
          <div key={id} className="bg-surface-2/50 rounded-lg p-2.5 border border-border">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-4 h-4 rounded bg-${color}-500/20 text-${color}-400 text-[9px] font-mono font-bold flex items-center justify-center`}>{id}</span>
              <span className="text-[10px] font-medium text-text-primary">{title}</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">{desc}</p>
          </div>
        ))}
      </div>
      <p className="text-[9px] text-text-muted mt-2.5">
        Your agent never sees credentials. Only the ephemeral L3 container — alive for one tool call — has access.
      </p>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function SetupPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Gateway</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Secure your AI agent's tool calls. Create a key, deploy the firewall, add your tools.
        </p>
      </div>

      <ApiKeysSection />
      <FirewallSection />
      <McpToolsSection />
      <SecuritySection />
    </div>
  );
}
