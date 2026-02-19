/**
 * Setup — API keys, integration modes, and MCP proxy architecture.
 * The primary onboarding surface: explains security model, provides connection
 * configs for every agent type, and manages API keys.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/common/Button.tsx';
import { getApiKeys, createApiKey, revokeApiKey, getOrgPolicySettings, updateOrgPolicySettings, getInstances, type ApiKeyInfo, type ApiKeyCreated, type Instance } from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

type IntegrationMode = 'mcp' | 'gpt' | 'claude' | 'custom';

const MODES: { id: IntegrationMode; label: string; desc: string }[] = [
  { id: 'mcp', label: 'MCP Proxy', desc: 'Any MCP agent' },
  { id: 'gpt', label: 'GPT Actions', desc: 'OpenAI' },
  { id: 'claude', label: 'Claude', desc: 'Anthropic' },
  { id: 'custom', label: 'REST API', desc: 'Any HTTP client' },
];

const API_BASE = import.meta.env.VITE_API_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
const SPEC_URL = `${API_BASE}/api/gateway/spec`;

const X_HANDLE_URL = 'https://x.com/wooblay';

export function SetupPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<IntegrationMode | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [selectedInstance, setSelectedInstance] = useState<string>('');
  const [copiedEndpoint, setCopiedEndpoint] = useState(false);

  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys });
  const { data: orgSettings } = useQuery({ queryKey: ['org-settings'], queryFn: getOrgPolicySettings, staleTime: 60_000 });
  const { data: instances = [] } = useQuery({ queryKey: ['instances'], queryFn: getInstances });
  const platformMode = (orgSettings as any)?.platformMode ?? 'firewall';

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

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
    mutationFn: () => createApiKey({
      name: newKeyName,
      expiresInDays: newKeyExpiry ? parseInt(newKeyExpiry) : undefined,
    }),
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

  const sseEndpoint = selectedInstance
    ? `${API_BASE}/mcp/${selectedInstance}`
    : `${API_BASE}/mcp/<instance-id>`;

  const copyEndpoint = () => {
    navigator.clipboard.writeText(sseEndpoint);
    setCopiedEndpoint(true);
    setTimeout(() => setCopiedEndpoint(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Setup</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Connect your agent to Wooblay's security gate. Every tool call is policy-checked, logged, and credentialed actions run in ephemeral containers.
        </p>
      </div>

      {/* ── Three-Layer Security Architecture ───────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">Security Architecture</h2>
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-surface-2/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-blue-500/20 text-blue-400 text-[10px] font-mono font-bold flex items-center justify-center">L1</span>
              <span className="text-[11px] font-medium text-text-primary">Policy Gate</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">
              Every tool call evaluated against dynamic policy rules. ALLOW / DENY / PENDING_APPROVAL. Scope boundaries enforce per-connection limits.
            </p>
          </div>
          <div className="bg-surface-2/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-400 text-[10px] font-mono font-bold flex items-center justify-center">L2</span>
              <span className="text-[11px] font-medium text-text-primary">Simulation</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">
              Pre-execution dry run in a sandboxed container. No network, no real credentials. Detects intent mismatch before real execution.
            </p>
          </div>
          <div className="bg-surface-2/50 rounded-lg p-3 border border-border">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-5 h-5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-mono font-bold flex items-center justify-center">L3</span>
              <span className="text-[11px] font-medium text-text-primary">Secure Execution</span>
            </div>
            <p className="text-[9px] text-text-muted leading-relaxed">
              Ephemeral container — vault creds injected, tool executes, result captured, container destroyed. Credentials exist for seconds, then gone.
            </p>
          </div>
        </div>
        <p className="text-[10px] text-text-muted border-t border-border pt-3">
          The agent never sees credentials. The proxy never sees credentials. Only the ephemeral container — which lives for the duration of one tool call — has access.
        </p>
      </div>

      {/* ── API Keys ─────────────────────────────────────────────────────── */}
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
                onClick={() => {
                  navigator.clipboard.writeText(createdKey.key);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 2000);
                }}
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

      {/* ── Integration Mode ─────────────────────────────────────────────── */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Connect Your Agent</h2>
        <p className="text-[10px] text-text-muted mb-4">
          One key, one endpoint. <a href="/credentials" className="text-accent hover:underline">Credentials</a> and <a href="/policies" className="text-accent hover:underline">policies</a> apply automatically — the key inherits both.
        </p>

        {/* Instance selector for concrete URLs */}
        {instances.length > 0 && (
          <div className="mb-4">
            <label className="block text-[9px] text-text-muted font-mono uppercase mb-1">Instance</label>
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="bg-surface-2 border border-border rounded-lg px-2.5 py-1.5 text-[11px] text-text-primary font-mono focus:outline-none focus:border-accent w-full max-w-xs"
            >
              <option value="">Select an instance for concrete URLs...</option>
              {instances.map((i: Instance) => (
                <option key={i.id} value={i.id}>{i.name} ({i.agentRuntime})</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-4">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3 py-2 rounded-lg text-left transition-colors ${mode === m.id ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'}`}
            >
              <span className="text-[11px] font-medium block">{m.label}</span>
              <span className={`text-[9px] ${mode === m.id ? 'text-white/70' : 'text-text-muted'}`}>{m.desc}</span>
            </button>
          ))}
        </div>

        {mode && (
          <div className="pt-3 border-t border-border space-y-4">

            {/* ── MCP Proxy (primary) ──────────────────────────────────── */}
            {mode === 'mcp' && (
              <>
                <div>
                  <h3 className="text-[11px] font-medium text-text-primary mb-2">How MCP Proxy works</h3>
                  <div className="bg-surface-2/50 rounded-lg p-4 mb-4 border border-border">
                    <pre className="text-[9px] font-mono text-text-secondary leading-relaxed whitespace-pre">{`Agent ─(SSE)─▶ MCP Proxy ──▶ Gate (L1 Policy + L2 Simulation)
                         │
                   ┌─────┴─────┐
                   │           │
             Non-credentialed  Credentialed
                   │           │
           Forward to      L3 Secure Exec:
           upstream MCP    ┌──────────────┐
           server          │ Ephemeral    │
                           │ container    │
                           │ + vault creds│
                           │ → execute    │
                           │ → return     │
                           │ → destroy    │
                           └──────────────┘`}</pre>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium text-text-primary mb-1">1. SSE Endpoint</h3>
                  <p className="text-[9px] text-text-muted mb-2">Your agent connects to this URL. All configured MCP tools are discovered automatically.</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 bg-surface-2 px-3 py-2 rounded-lg text-[11px] font-mono text-accent break-all select-all">
                      {sseEndpoint}
                    </code>
                    <button onClick={copyEndpoint}
                      className="shrink-0 px-3 py-2 text-[10px] bg-surface-2 hover:bg-surface-3 text-text-secondary rounded-lg transition-colors">
                      {copiedEndpoint ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium text-text-primary mb-1">2. Claude Desktop</h3>
                  <pre className="bg-surface-2 rounded-lg p-3 text-[10px] font-mono text-text-secondary overflow-x-auto">{`{
  "mcpServers": {
    "wooblay": {
      "url": "${sseEndpoint}",
      "transport": "sse",
      "headers": {
        "Authorization": "Bearer wbl_ak_..."
      }
    }
  }
}`}</pre>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium text-text-primary mb-1">3. Cursor</h3>
                  <pre className="bg-surface-2 rounded-lg p-3 text-[10px] font-mono text-text-secondary overflow-x-auto">{`{
  "mcpServers": {
    "wooblay": {
      "url": "${sseEndpoint}",
      "transport": "sse",
      "headers": { "Authorization": "Bearer wbl_ak_..." }
    }
  }
}`}</pre>
                </div>

                <div>
                  <h3 className="text-[11px] font-medium text-text-primary mb-1">4. Any MCP Client</h3>
                  <pre className="bg-surface-2 rounded-lg p-3 text-[10px] font-mono text-text-secondary overflow-x-auto">{`// Connect via SSE transport
const transport = new SSEClientTransport(
  new URL("${sseEndpoint}"),
  { headers: { "Authorization": "Bearer wbl_ak_..." } }
);
const client = new Client({ name: "my-agent", version: "1.0" });
await client.connect(transport);

// tools/list discovers all configured MCP tools automatically
const { tools } = await client.listTools();

// Every call is gated — credentialed tools run in ephemeral containers
const result = await client.callTool({
  name: "github-tools__create_pull_request",
  arguments: { title: "...", base: "main", head: "feature" }
});`}</pre>
                </div>

                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg px-4 py-3">
                  <p className="text-[10px] text-emerald-400 font-medium mb-2">What makes this different</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <p className="text-[9px] text-emerald-400/80">Zero credential exposure</p>
                    <p className="text-[9px] text-emerald-400/60">Agent and proxy never see secrets</p>
                    <p className="text-[9px] text-emerald-400/80">Automatic tool discovery</p>
                    <p className="text-[9px] text-emerald-400/60">Add an MCP server, tools appear instantly</p>
                    <p className="text-[9px] text-emerald-400/80">Per-call ephemeral containers</p>
                    <p className="text-[9px] text-emerald-400/60">Creds exist for seconds, then destroyed</p>
                    <p className="text-[9px] text-emerald-400/80">Full audit trail</p>
                    <p className="text-[9px] text-emerald-400/60">Every tool call logged with receipt chain</p>
                    <p className="text-[9px] text-emerald-400/80">Runtime agnostic</p>
                    <p className="text-[9px] text-emerald-400/60">Any MCP-compatible agent works</p>
                    <p className="text-[9px] text-emerald-400/80">Pre-execution simulation</p>
                    <p className="text-[9px] text-emerald-400/60">L2 sandbox catches intent mismatch</p>
                  </div>
                </div>

                <p className="text-[10px] text-text-muted">
                  Configure upstream MCP servers and vault connections on each instance's{' '}
                  <a href="/instances" className="text-accent hover:underline">Security tab</a>. Tools from all configured servers are multiplexed through a single endpoint.
                </p>
              </>
            )}

            {/* ── GPT Actions ─────────────────────────────────────────── */}
            {mode === 'gpt' && (
              <>
                <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc list-inside mb-3">
                  <li>In your GPT: Configure → Actions → Import from URL or paste the spec.</li>
                  <li>Set authentication: Bearer token, paste your API key.</li>
                  <li>The model will see the execute action and call it when it needs to run something.</li>
                  <li>Every call goes through all three security layers.</li>
                </ul>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}

            {/* ── Claude ──────────────────────────────────────────────── */}
            {mode === 'claude' && (
              <>
                <p className="text-[11px] text-text-secondary mb-3">
                  For Claude Desktop or Claude API, use the MCP Proxy (recommended) or call the REST gateway directly.
                </p>
                <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc list-inside mb-3">
                  <li><strong>MCP Proxy (recommended)</strong> — switch to the MCP tab for config. Claude Desktop natively supports MCP.</li>
                  <li><strong>REST fallback</strong> — <code className="bg-surface-2 px-1 rounded text-[10px]">POST /api/gateway/execute</code> with <code className="bg-surface-2 px-1 rounded text-[10px]">Authorization: Bearer wbl_ak_...</code></li>
                </ul>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}

            {/* ── Custom / REST ────────────────────────────────────────── */}
            {mode === 'custom' && (
              <>
                <div className="space-y-2 mb-3">
                  <div>
                    <p className="text-[10px] font-medium text-text-primary mb-1">Endpoint</p>
                    <code className="block bg-surface-2 px-3 py-2 rounded-lg text-[11px] font-mono text-accent">POST {API_BASE}/api/gateway/execute</code>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-text-primary mb-1">Headers</p>
                    <code className="block bg-surface-2 px-3 py-2 rounded-lg text-[10px] font-mono text-text-secondary">Authorization: Bearer wbl_ak_...</code>
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-text-primary mb-1">Body</p>
                    <pre className="bg-surface-2 rounded-lg p-3 text-[10px] font-mono text-text-secondary overflow-x-auto">{`{
  "action": "github:pr:create",
  "params": {
    "title": "Add feature",
    "base": "main",
    "head": "feature-branch",
    "repo": "owner/repo"
  }
}`}</pre>
                  </div>
                </div>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}
          </div>
        )}

        <p className="text-[10px] text-text-muted mt-4 pt-3 border-t border-border/50">
          All paths — MCP, REST, GPT Actions — route through the same three-layer security moat. Policy evaluation, pre-execution simulation, ephemeral container execution. Agent never sees credentials.
        </p>
      </div>

      {/* ── Request full platform access ──────────────────────────────── */}
      {platformMode === 'firewall' && (
        <div className="bg-surface-1 border border-purple-500/20 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-text-primary mb-1">Request full platform access</h2>
          <p className="text-[11px] text-text-secondary mb-3">
            Full platform unlocks hosted agents, sensors (webhooks, event rules), and orchestration. We offer it to teams that need more than the firewall — same security, more capabilities.
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
