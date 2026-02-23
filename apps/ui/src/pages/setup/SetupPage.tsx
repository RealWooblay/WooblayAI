/**
 * Gateway — single guided page for the Wooblay firewall.
 * Flow: API Keys → Your Firewall (status + connect) → MCP Tools → Security
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Button } from '../../components/common/Button.tsx';
import {
  getApiKeys, createApiKey, revokeApiKey,
  getInstances, createInstance, deleteInstance,
  getMcpServers, addMcpServer, updateMcpServer, deleteMcpServer,
  getConnections, createConnection, addConnectionSecret, probeMcpServer, getStats,
  type ApiKeyInfo, type ApiKeyCreated, type Instance, type McpServerConfig, type CreateMcpServerRequest,
} from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

const API_BASE = import.meta.env.VITE_API_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');

// ── MCP Server Catalog ──────────────────────────────────────────────────────

interface McpCatalogEntry {
  name: string;
  label: string;
  desc: string;
  transport: 'stdio' | 'sse';
  source: string;
  /** Env vars this server requires at runtime. Empty = no credentials needed. */
  requiredEnvVars: { key: string; placeholder: string; hint: string }[];
}

const MCP_CATALOG: McpCatalogEntry[] = [
  { name: 'github', label: 'GitHub', desc: 'Repos, PRs, issues, files', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-github',
    requiredEnvVars: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', placeholder: 'ghp_...', hint: 'Fine-grained PAT with repo access' }] },
  { name: 'filesystem', label: 'Filesystem', desc: 'Read, write, search files', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-filesystem /',
    requiredEnvVars: [] },
  { name: 'brave-search', label: 'Brave Search', desc: 'Web search', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-brave-search',
    requiredEnvVars: [{ key: 'BRAVE_API_KEY', placeholder: 'BSA...', hint: 'Brave Search API key from brave.com/search/api' }] },
  { name: 'slack', label: 'Slack', desc: 'Messages, channels, users', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-slack',
    requiredEnvVars: [{ key: 'SLACK_BOT_TOKEN', placeholder: 'xoxb-...', hint: 'Bot User OAuth Token from Slack app settings' }, { key: 'SLACK_TEAM_ID', placeholder: 'T0...', hint: 'Workspace ID from Slack admin' }] },
  { name: 'postgres', label: 'PostgreSQL', desc: 'Query databases', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-postgres',
    requiredEnvVars: [{ key: 'POSTGRES_CONNECTION_STRING', placeholder: 'postgresql://user:pass@host:5432/db', hint: 'Full connection string' }] },
  { name: 'gdrive', label: 'Google Drive', desc: 'Files, search, share', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-gdrive',
    requiredEnvVars: [{ key: 'GOOGLE_APPLICATION_CREDENTIALS', placeholder: '{"type":"service_account",...}', hint: 'Service account JSON key' }] },
  { name: 'puppeteer', label: 'Puppeteer', desc: 'Browser automation', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-puppeteer',
    requiredEnvVars: [] },
  { name: 'memory', label: 'Memory', desc: 'Persistent knowledge graph', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-memory',
    requiredEnvVars: [] },
  { name: 'fetch', label: 'Fetch', desc: 'HTTP requests', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-fetch',
    requiredEnvVars: [] },
  { name: 'sequential-thinking', label: 'Thinking', desc: 'Step-by-step reasoning', transport: 'stdio', source: 'npx -y @modelcontextprotocol/server-sequential-thinking',
    requiredEnvVars: [] },
];

/** Real brand icon URLs (Simple Icons CDN). Fallback for unknown: generic gear. */
const MCP_ICON_URLS: Record<string, string> = {
  github: 'https://cdn.simpleicons.org/github/a1a1aa',
  slack: 'https://cdn.simpleicons.org/slack/a1a1aa',
  postgres: 'https://cdn.simpleicons.org/postgresql/a1a1aa',
  gdrive: 'https://cdn.simpleicons.org/googledrive/a1a1aa',
  'brave-search': 'https://cdn.simpleicons.org/brave/a1a1aa',
};

function McpCatalogIcon({ name }: { name: string }) {
  const url = MCP_ICON_URLS[name];
  if (url) {
    return (
      <img src={url} alt="" className="w-6 h-6 object-contain shrink-0" />
    );
  }
  return (
    <div className="w-6 h-6 rounded bg-surface-3 flex items-center justify-center shrink-0">
      <svg className="w-3.5 h-3.5 text-text-tertiary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    </div>
  );
}

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

function CredentialPicker({ connections, selected, onToggle }: { connections: any[]; selected: string[]; onToggle: (id: string) => void }) {
  if (connections.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {connections.map((c: any) => (
        <button key={c.id} type="button" onClick={() => onToggle(c.id)}
          className={clsx(
            'px-2.5 py-1 rounded text-[10px] font-mono transition-colors border',
            selected.includes(c.id) ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : 'border-border text-text-secondary hover:bg-surface-3',
          )}>
          {c.name}
        </button>
      ))}
    </div>
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

type ConnectTab = 'sse' | 'http';

function FirewallSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: getInstances });
  const { data: stats } = useQuery({ queryKey: ['stats'], queryFn: getStats, refetchInterval: 10_000 });

  const proxy = instances.find((i: Instance) => i.instanceType === 'proxy');
  const sseEndpoint = proxy ? `${API_BASE}/mcp/${proxy.id}/sse` : '';

  const [proxyName, setProxyName] = useState('');
  const [tab, setTab] = useState<ConnectTab>('sse');
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

  const cursorSnippet = JSON.stringify({
    mcpServers: {
      wooblay: {
        url: sseEndpoint || 'https://wooblay.com/mcp/YOUR_INSTANCE_ID/sse',
        transport: 'sse',
        headers: { Authorization: 'Bearer YOUR_API_KEY' },
      },
    },
  }, null, 2);

  const claudeSnippet = JSON.stringify({
    mcpServers: {
      wooblay: {
        command: 'node',
        args: [
          '/path/to/wooblay-mcp-plugin/scripts/claude-desktop-bridge.mjs',
          sseEndpoint || 'https://wooblay.com/mcp/YOUR_INSTANCE_ID/sse',
          'YOUR_API_KEY',
        ],
      },
    },
  }, null, 2);

  const httpSnippet = `curl -X POST ${API_BASE}/api/gateway/execute \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action": "mcp:tool-call",
    "toolName": "github__create_issue",
    "args": { "title": "Bug fix", "repo": "org/repo" }
  }'`;

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-text-primary">Your Firewall</h2>
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

          <div className="mb-4">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-surface-0 border border-border px-3 py-2.5 rounded-lg text-[12px] font-mono text-text-primary break-all select-all">
                {sseEndpoint}
              </code>
              <CopyButton text={sseEndpoint} />
            </div>
            <p className="text-[9px] text-text-muted mt-1.5">Use your API key as the Bearer token. Replace YOUR_API_KEY with your key in the snippets below.</p>
          </div>

          <div className="bg-surface-0 border border-border rounded-xl overflow-hidden">
            <div className="flex border-b border-border">
              {([['sse', 'SSE (Cursor & Claude)'], ['http', 'HTTP / cURL']] as const).map(([key, label]) => (
                <button key={key} onClick={() => setTab(key as ConnectTab)}
                  className={clsx(
                    'flex-1 px-4 py-2 text-[11px] font-medium transition-colors',
                    tab === key ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-text-tertiary hover:text-text-secondary',
                  )}>
                  {label}
                </button>
              ))}
            </div>
            {tab === 'sse' ? (
              <div className="divide-y divide-border">
                <div className="p-4">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Cursor — .cursor/mcp.json</p>
                  <p className="text-[10px] text-text-tertiary mb-2">Cursor supports SSE natively. Add this to your project or user MCP config.</p>
                  <div className="flex gap-2">
                    <pre className="flex-1 p-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed rounded-lg bg-surface-1 border border-border">{cursorSnippet}</pre>
                    <CopyButton text={cursorSnippet} />
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Claude Desktop — claude_desktop_config.json</p>
                  <p className="text-[10px] text-text-tertiary mb-2">Claude only supports stdio. Use the bridge script (replace the path with your clone of wooblay-mcp-plugin).</p>
                  <div className="flex gap-2">
                    <pre className="flex-1 p-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed rounded-lg bg-surface-1 border border-border">{claudeSnippet}</pre>
                    <CopyButton text={claudeSnippet} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4">
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-2">Direct API</p>
                <div className="flex gap-2">
                  <pre className="flex-1 p-3 text-[11px] font-mono text-text-secondary overflow-x-auto whitespace-pre leading-relaxed rounded-lg bg-surface-1 border border-border">{httpSnippet}</pre>
                  <CopyButton text={httpSnippet} />
                </div>
              </div>
            )}
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
    refetchInterval: (query) => {
      const data = query.state.data as McpServerConfig[] | undefined;
      return data?.some((s) => s.status === 'pending' || s.status === 'connecting') ? 5_000 : false;
    },
  });

  const { data: connections = [] } = useQuery({ queryKey: ['connections'], queryFn: getConnections });
  const activeConns = connections.filter((c: any) => c.status === 'active');

  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customTransport, setCustomTransport] = useState<'stdio' | 'sse'>('stdio');
  const [customSource, setCustomSource] = useState('');
  const [selectedConnIds, setSelectedConnIds] = useState<string[]>([]);
  // Probe state for custom servers
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeResult, setProbeResult] = useState<{ detectedEnvVars: string[]; serverStarted: boolean; stderr: string } | null>(null);
  const [customEnvValues, setCustomEnvValues] = useState<Record<string, string>>({});

  // Catalog credential picker state
  const [catalogCredsPicker, setCatalogCredsPicker] = useState<string | null>(null);
  const [catalogConnIds, setCatalogConnIds] = useState<string[]>([]);
  // Inline credential values keyed by env var name (for catalog items with requiredEnvVars)
  const [catalogEnvValues, setCatalogEnvValues] = useState<Record<string, string>>({});

  // Inline credential editor for configured servers
  const [editingCredsFor, setEditingCredsFor] = useState<string | null>(null);
  const [editConnIds, setEditConnIds] = useState<string[]>([]);

  const addMut = useMutation({
    mutationFn: (config: CreateMcpServerRequest) => addMcpServer(proxy!.id, config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', proxy?.id] });
      toast('Tool server added', 'success');
      setShowCustom(false);
      setCustomName('');
      setCustomSource('');
      setSelectedConnIds([]);
      setCatalogCredsPicker(null);
      setCatalogConnIds([]);
    },
    onError: (err: any) => toast(`Failed: ${err?.body ?? err.message}`, 'error'),
  });

  const updateCredsMut = useMutation({
    mutationFn: ({ id, connectionIds }: { id: string; connectionIds: string[] }) => updateMcpServer(proxy!.id, id, { connectionIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mcp-servers', proxy?.id] });
      toast('Credentials updated', 'success');
      setEditingCredsFor(null);
      setEditConnIds([]);
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

  const toggleConn = (id: string, list: string[], setter: (v: string[]) => void) =>
    setter(list.includes(id) ? list.filter(c => c !== id) : [...list, id]);

  const addFromCatalog = (item: McpCatalogEntry) => {
    if (!proxy) return;
    const alreadyAdded = servers.some((s: McpServerConfig) => s.name === item.name);
    if (alreadyAdded) { toast(`${item.label} is already added`, 'info'); return; }

    if (item.requiredEnvVars.length === 0) {
      // No credentials needed — add immediately
      addMut.mutate({ name: item.name, transport: item.transport, source: item.source });
    } else {
      // Show inline credential form with the exact env vars this server needs
      setCatalogCredsPicker(item.name);
      setCatalogConnIds([]);
      setCatalogEnvValues({});
    }
  };

  const confirmCatalogAdd = async () => {
    const item = MCP_CATALOG.find(c => c.name === catalogCredsPicker);
    if (!item) return;

    // If user entered inline credentials, auto-create a connection + exec_only secrets
    const hasInlineValues = item.requiredEnvVars.some(v => catalogEnvValues[v.key]?.trim());

    if (hasInlineValues) {
      try {
        const conn: any = await createConnection({
          provider: item.name,
          name: `${item.label} (auto)`,
          credential: catalogEnvValues[item.requiredEnvVars[0]?.key] || 'managed-via-secrets',
        });
        // Create exec_only secrets for each env var
        for (const envVar of item.requiredEnvVars) {
          const val = catalogEnvValues[envVar.key]?.trim();
          if (val) {
            await addConnectionSecret(conn.id, { key: envVar.key, value: val, mode: 'exec_only' });
          }
        }
        addMut.mutate({
          name: item.name,
          transport: item.transport,
          source: item.source,
          connectionIds: [conn.id],
        });
        qc.invalidateQueries({ queryKey: ['connections'] });
      } catch (err: any) {
        toast(`Failed to create credentials: ${err?.message ?? err}`, 'error');
      }
    } else if (catalogConnIds.length > 0) {
      // User linked existing connections
      addMut.mutate({
        name: item.name,
        transport: item.transport,
        source: item.source,
        connectionIds: catalogConnIds,
      });
    } else {
      // No credentials at all
      addMut.mutate({ name: item.name, transport: item.transport, source: item.source });
    }
  };

  const handleCustomSubmit = async () => {
    if (!customName.trim() || !customSource.trim()) return;
    const name = customName.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // If user entered env var values from probe, auto-create connection + secrets
    const envEntries = Object.entries(customEnvValues).filter(([, v]) => v.trim());
    let connectionIds = selectedConnIds.length > 0 ? [...selectedConnIds] : undefined;

    if (envEntries.length > 0) {
      try {
        const conn: any = await createConnection({
          provider: name,
          name: `${customName.trim()} credentials`,
          credential: envEntries[0][1],
        });
        for (const [key, value] of envEntries) {
          await addConnectionSecret(conn.id, { key, value, mode: 'exec_only' });
        }
        connectionIds = [...(connectionIds ?? []), conn.id];
        qc.invalidateQueries({ queryKey: ['connections'] });
      } catch (err: any) {
        toast(`Failed to save credentials: ${err?.message ?? err}`, 'error');
        return;
      }
    }

    addMut.mutate({ name, transport: customTransport, source: customSource.trim(), connectionIds });
  };

  const runProbe = async () => {
    if (!customSource.trim()) return;
    setProbeLoading(true);
    setProbeResult(null);
    try {
      const result = await probeMcpServer(customSource.trim());
      setProbeResult(result);
      if (result.detectedEnvVars.length > 0) {
        toast(`Detected ${result.detectedEnvVars.length} required env var(s)`, 'success');
      } else if (result.serverStarted) {
        toast('Server started OK — no credentials required', 'success');
      } else {
        toast('Could not auto-detect requirements. Check the server docs.', 'info');
      }
    } catch (err: any) {
      toast(`Probe failed: ${err?.message ?? err}`, 'error');
    } finally {
      setProbeLoading(false);
    }
  };

  const startEditCreds = (s: McpServerConfig) => {
    setEditingCredsFor(s.id);
    setEditConnIds([...(s.connectionIds ?? [])]);
  };

  if (!proxy) return null;

  const configuredNames = new Set(servers.map((s: McpServerConfig) => s.name));

  return (
    <div className="bg-surface-1 border border-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-sm font-semibold text-text-primary">MCP Tools</h2>
      </div>
      <p className="text-[10px] text-text-muted mb-4">
        Add MCP tool servers. Every tool call flows through the policy engine. Credentials are vault-encrypted and injected at runtime.
      </p>

      {/* Catalog grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2 mb-4">
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
              <div className="mb-1.5 flex items-center justify-start">
                <McpCatalogIcon name={item.name} />
              </div>
              <div className="text-[11px] font-medium text-text-primary mb-0.5">{item.label}</div>
              <div className="text-[9px] text-text-muted leading-snug">{item.desc}</div>
              {added && (() => {
                const srv = servers.find((s: McpServerConfig) => s.name === item.name);
                if (!srv) return <div className="text-[8px] text-emerald-400 font-medium mt-1">added</div>;
                if (srv.status === 'connected') return <div className="text-[8px] text-emerald-400 font-medium mt-1">{srv.toolCount} tool{srv.toolCount !== 1 ? 's' : ''}</div>;
                if (srv.status === 'connecting') return <div className="text-[8px] text-amber-400 font-medium mt-1">connecting…</div>;
                if (srv.status === 'error') return <div className="text-[8px] text-red-400 font-medium mt-1" title={srv.lastError ?? undefined}>error</div>;
                return <div className="text-[8px] text-zinc-400 font-medium mt-1">pending</div>;
              })()}
            </button>
          );
        })}
      </div>

      {/* Catalog credential setup (shown after clicking a catalog item that needs credentials) */}
      {catalogCredsPicker && (() => {
        const catalogItem = MCP_CATALOG.find(c => c.name === catalogCredsPicker);
        if (!catalogItem) return null;
        const hasRequiredVars = catalogItem.requiredEnvVars.length > 0;
        const allFilled = catalogItem.requiredEnvVars.every(v => catalogEnvValues[v.key]?.trim());
        const hasLinkedConn = catalogConnIds.length > 0;

        return (
          <div className="border border-accent/30 rounded-lg p-4 bg-accent/5 mb-4 space-y-3">
            <div className="text-[11px] font-medium text-text-primary">
              Add <span className="text-accent">{catalogItem.label}</span>
              {hasRequiredVars && <span className="text-text-muted font-normal"> — enter credentials</span>}
            </div>

            {/* Inline env var fields — the user doesn't need to know what the server expects, we tell them */}
            {hasRequiredVars && (
              <div className="space-y-2">
                {catalogItem.requiredEnvVars.map((envVar) => (
                  <div key={envVar.key}>
                    <div className="flex items-center gap-2 mb-1">
                      <label className="text-[9px] font-mono text-accent/80 uppercase">{envVar.key}</label>
                      <span className="text-[9px] text-text-muted">{envVar.hint}</span>
                    </div>
                    <input
                      type="password"
                      value={catalogEnvValues[envVar.key] ?? ''}
                      onChange={(e) => setCatalogEnvValues(prev => ({ ...prev, [envVar.key]: e.target.value }))}
                      placeholder={envVar.placeholder}
                      className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Existing connection link (advanced) */}
            {activeConns.length > 0 && (
              <details className="text-[10px]">
                <summary className="text-text-muted cursor-pointer hover:text-text-secondary">
                  Or link an existing connection
                </summary>
                <div className="mt-2">
                  <CredentialPicker
                    connections={activeConns}
                    selected={catalogConnIds}
                    onToggle={(id) => toggleConn(id, catalogConnIds, setCatalogConnIds)}
                  />
                </div>
              </details>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => { setCatalogCredsPicker(null); setCatalogConnIds([]); setCatalogEnvValues({}); }}
                className="px-3 py-1.5 text-[10px] font-mono text-text-secondary hover:text-text-primary">Cancel</button>
              <button onClick={() => {
                setCatalogEnvValues({});
                setCatalogConnIds([]);
                confirmCatalogAdd();
              }}
                className="px-3 py-1.5 text-[10px] font-mono text-text-secondary hover:text-text-primary">Add without credentials</button>
              <button onClick={confirmCatalogAdd} disabled={(!allFilled && !hasLinkedConn) || addMut.isPending}
                className="px-4 py-1.5 rounded bg-accent text-surface-0 text-[11px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">
                {addMut.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        );
      })()}

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
            <div className="flex gap-2">
              <input value={customSource} onChange={(e) => { setCustomSource(e.target.value); setProbeResult(null); }}
                placeholder={customTransport === 'stdio' ? 'npx -y @org/server-name' : 'https://mcp.example.com/sse'}
                className="flex-1 bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none" />
              {customTransport === 'stdio' && (
                <button
                  onClick={runProbe}
                  disabled={!customSource.trim() || probeLoading}
                  className="px-3 py-1.5 rounded border border-accent/40 text-accent text-[10px] font-mono font-medium hover:bg-accent/10 disabled:opacity-40 transition-colors whitespace-nowrap"
                >
                  {probeLoading ? 'Scanning…' : 'Detect credentials'}
                </button>
              )}
            </div>
            {!probeResult && !probeLoading && (
              <p className="text-[9px] text-text-muted mt-1">
                Enter the server command and click Detect to auto-discover what credentials it needs.
              </p>
            )}
          </div>

          {/* Probe results — detected env vars */}
          {probeResult && probeResult.detectedEnvVars.length > 0 && (
            <div className="border border-accent/20 rounded-lg p-3 bg-accent/5 space-y-2">
              <div className="text-[10px] text-accent font-mono font-medium">
                Detected {probeResult.detectedEnvVars.length} required env var{probeResult.detectedEnvVars.length !== 1 ? 's' : ''}
              </div>
              {probeResult.detectedEnvVars.map((varName) => (
                <div key={varName}>
                  <label className="text-[9px] font-mono text-accent/80 uppercase block mb-0.5">{varName}</label>
                  <input
                    type="password"
                    value={customEnvValues[varName] ?? ''}
                    onChange={(e) => setCustomEnvValues(prev => ({ ...prev, [varName]: e.target.value }))}
                    placeholder={`Enter ${varName}`}
                    className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-[11px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
                  />
                </div>
              ))}
              <p className="text-[8px] text-text-muted">
                Values are vault-encrypted and injected as env vars into L3 execution containers only.
              </p>
            </div>
          )}

          {probeResult && probeResult.serverStarted && probeResult.detectedEnvVars.length === 0 && (
            <div className="text-[10px] text-emerald-400 font-mono bg-emerald-500/5 border border-emerald-500/10 rounded px-3 py-2">
              Server starts without credentials — no secrets required.
            </div>
          )}

          {probeResult && !probeResult.serverStarted && probeResult.detectedEnvVars.length === 0 && (
            <div className="text-[10px] text-amber-400 font-mono bg-amber-500/5 border border-amber-500/10 rounded px-3 py-2 space-y-1">
              <div>Could not auto-detect requirements from server output.</div>
              <details className="text-[9px] text-text-muted">
                <summary className="cursor-pointer hover:text-text-secondary">Show raw output</summary>
                <pre className="mt-1 whitespace-pre-wrap break-all text-[8px] max-h-24 overflow-y-auto">{probeResult.stderr}</pre>
              </details>
              <p className="text-[9px] text-text-muted">You can still add env vars manually below, or check the server docs.</p>
            </div>
          )}

          {/* Manual env var entry (always available) */}
          {!probeResult?.detectedEnvVars.length && (
            <details className="text-[10px]">
              <summary className="text-text-muted cursor-pointer hover:text-text-secondary font-mono">
                Manually add env vars
              </summary>
              <div className="mt-2 space-y-2">
                {Object.entries(customEnvValues).map(([key]) => (
                  <div key={key} className="flex gap-2 items-center">
                    <input
                      value={key}
                      readOnly
                      className="w-1/3 bg-surface-2 border border-border rounded px-2 py-1 text-[10px] font-mono text-text-secondary"
                    />
                    <input
                      type="password"
                      value={customEnvValues[key] ?? ''}
                      onChange={(e) => setCustomEnvValues(prev => ({ ...prev, [key]: e.target.value }))}
                      placeholder="value"
                      className="flex-1 bg-surface-2 border border-border rounded px-2 py-1 text-[10px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none"
                    />
                    <button
                      onClick={() => setCustomEnvValues(prev => { const n = { ...prev }; delete n[key]; return n; })}
                      className="text-red-400 hover:text-red-300 text-[10px]"
                    >×</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    id="custom-env-key-input"
                    placeholder="ENV_VAR_NAME"
                    className="w-1/3 bg-surface-2 border border-border rounded px-2 py-1 text-[10px] font-mono text-text-primary placeholder:text-text-muted focus:border-accent/50 outline-none uppercase"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const inp = e.currentTarget;
                        const key = inp.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').trim();
                        if (key) { setCustomEnvValues(prev => ({ ...prev, [key]: '' })); inp.value = ''; }
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      const inp = document.getElementById('custom-env-key-input') as HTMLInputElement;
                      const key = inp?.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').trim();
                      if (key) { setCustomEnvValues(prev => ({ ...prev, [key]: '' })); inp.value = ''; }
                    }}
                    className="px-2 py-1 rounded border border-border text-[10px] font-mono text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
                  >+ add</button>
                </div>
              </div>
            </details>
          )}

          {activeConns.length > 0 && (
            <details className="text-[10px]">
              <summary className="text-text-muted cursor-pointer hover:text-text-secondary font-mono">
                Link existing vault connection
              </summary>
              <div className="mt-2">
                <CredentialPicker connections={activeConns} selected={selectedConnIds} onToggle={(id) => toggleConn(id, selectedConnIds, setSelectedConnIds)} />
              </div>
            </details>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowCustom(false); setSelectedConnIds([]); setProbeResult(null); setCustomEnvValues({}); }}
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
            <div key={s.id} className="bg-surface-0 border border-border rounded-lg overflow-hidden">
              <div className={clsx('flex items-center justify-between px-3 py-2 group', !s.enabled && 'opacity-50')}>
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
                  {s.status === 'connected' && (
                    <span className="text-[8px] bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded font-mono">{s.toolCount} tool{s.toolCount !== 1 ? 's' : ''}</span>
                  )}
                  {s.status === 'connecting' && (
                    <span className="text-[8px] bg-amber-500/10 text-amber-400 px-1.5 py-0.5 rounded font-mono">connecting…</span>
                  )}
                  {s.status === 'error' && (
                    <span className="text-[8px] bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded font-mono" title={s.lastError ?? undefined}>error</span>
                  )}
                  {s.status === 'pending' && (
                    <span className="text-[8px] bg-zinc-500/10 text-zinc-400 px-1.5 py-0.5 rounded font-mono">pending</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {activeConns.length > 0 && (
                    <button onClick={() => editingCredsFor === s.id ? setEditingCredsFor(null) : startEditCreds(s)}
                      className="text-[10px] text-accent/60 hover:text-accent font-mono transition-colors opacity-0 group-hover:opacity-100">
                      {editingCredsFor === s.id ? 'close' : 'credentials'}
                    </button>
                  )}
                  <button onClick={() => removeMut.mutate(s.id)}
                    className="text-[10px] text-red-400/0 group-hover:text-red-400/60 hover:!text-red-400 transition-colors font-mono">
                    remove
                  </button>
                </div>
              </div>

              {/* Inline credential editor */}
              {editingCredsFor === s.id && (
                <div className="border-t border-border px-3 py-2.5 bg-surface-1/50 space-y-2">
                  <div className="text-[9px] text-text-muted font-mono uppercase">Vault Credentials</div>
                  <CredentialPicker connections={activeConns} selected={editConnIds} onToggle={(id) => toggleConn(id, editConnIds, setEditConnIds)} />
                  <div className="flex justify-end gap-2 pt-1">
                    <button onClick={() => setEditingCredsFor(null)} className="text-[10px] font-mono text-text-secondary">Cancel</button>
                    <button onClick={() => updateCredsMut.mutate({ id: s.id, connectionIds: editConnIds })}
                      disabled={updateCredsMut.isPending}
                      className="px-3 py-1 rounded bg-accent text-surface-0 text-[10px] font-mono font-medium disabled:opacity-40 hover:bg-accent/90 transition-colors">
                      {updateCredsMut.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              )}
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
    <details className="bg-surface-1 border border-border rounded-xl">
      <summary className="px-5 py-4 cursor-pointer text-sm font-semibold text-text-primary hover:text-accent transition-colors">
        How It Works
      </summary>
      <div className="px-5 pb-5">
        <div className="grid grid-cols-3 gap-3">
          {[
            { title: 'Policy Gate', desc: 'Every tool call checked against your rules. Allow, deny, or require approval.' },
            { title: 'Simulation', desc: 'Sandboxed pre-execution. No network, no credentials. Catches intent mismatch.' },
            { title: 'Secure Exec', desc: 'Ephemeral container — vault creds injected, tool runs, container destroyed.' },
          ].map(({ title, desc }) => (
            <div key={title} className="text-center">
              <p className="text-xs font-medium text-text-primary mb-1">{title}</p>
              <p className="text-[10px] text-text-tertiary leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export function SetupPage() {
  return (
    <div className="space-y-5">
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
