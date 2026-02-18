/**
 * Setup — API keys and integration by agent type. Minimal, mode-specific instructions.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/common/Button.tsx';
import { getApiKeys, createApiKey, revokeApiKey, getOrgPolicySettings, updateOrgPolicySettings, type ApiKeyInfo, type ApiKeyCreated } from '../../api/client.ts';
import { useToast } from '../../components/common/Toast.tsx';

type IntegrationMode = 'gpt' | 'claude' | 'mcp' | 'custom';

const MODES: { id: IntegrationMode; label: string }[] = [
  { id: 'gpt', label: 'GPT (OpenAI)' },
  { id: 'claude', label: 'Claude' },
  { id: 'mcp', label: 'MCP' },
  { id: 'custom', label: 'Custom / API' },
];

const API_BASE = import.meta.env.VITE_API_URL ?? (typeof window !== 'undefined' ? window.location.origin : '');
const SPEC_URL = `${API_BASE}/api/gateway/spec`;
const EXECUTE_URL = `${API_BASE}/api/gateway/execute`;

const X_HANDLE_URL = 'https://x.com/wooblay';

export function SetupPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<IntegrationMode | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');

  const { data: apiKeys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: getApiKeys });
  const { data: orgSettings } = useQuery({ queryKey: ['org-settings'], queryFn: getOrgPolicySettings, staleTime: 60_000 });
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

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-lg font-bold text-text-primary">Setup</h1>
        <p className="text-xs text-text-muted mt-0.5">
          One key, one endpoint. Connect <a href="/credentials" className="text-accent hover:underline">credentials</a> and set <a href="/policies" className="text-accent hover:underline">policies</a> first; the key inherits both.
        </p>
      </div>

      {/* API Keys */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">API Keys</h2>

        {createdKey && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 mb-4">
            <p className="text-[11px] font-medium text-emerald-400 mb-2">Copy now — won’t be shown again</p>
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

      {/* Choose integration → mode-specific instructions */}
      <div className="bg-surface-1 border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-text-primary mb-3">How will your agent connect?</h2>
        <div className="flex flex-wrap gap-2 mb-4">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${mode === m.id ? 'bg-accent text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary'}`}
            >
              {m.label}
            </button>
          ))}
        </div>

        {mode && (
          <div className="pt-2 border-t border-border">
            {mode === 'gpt' && (
              <>
                <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc list-inside mb-3">
                  <li>In your GPT: Configure → Actions → Import from URL or paste the spec.</li>
                  <li>Set authentication: Bearer token, paste your API key.</li>
                  <li>The model will see the execute action and call it when it needs to run something.</li>
                </ul>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}
            {mode === 'claude' && (
              <>
                <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc list-inside mb-3">
                  <li>Use an MCP server that forwards tool calls to the Wooblay gateway, or call the API from your app.</li>
                  <li>Auth: <code className="bg-surface-2 px-1 rounded text-[10px]">Authorization: Bearer &lt;your-key&gt;</code></li>
                  <li>Endpoint: <code className="bg-surface-2 px-1 rounded text-[10px]">POST /api/gateway/execute</code> with <code className="bg-surface-2 px-1 rounded text-[10px]">{"{ action, params }"}</code></li>
                </ul>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}
            {mode === 'mcp' && (
              <>
                <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc list-inside mb-3">
                  <li>Expose a tool that POSTs to your gateway with the API key in the header.</li>
                  <li>URL: <code className="bg-surface-2 px-1 rounded text-[10px] break-all">{EXECUTE_URL}</code></li>
                  <li>Body: <code className="bg-surface-2 px-1 rounded text-[10px]">{"{ \"action\": \"...\", \"params\": { \"command\": \"...\", \"provider\": \"github\" } }"}</code></li>
                </ul>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}
            {mode === 'custom' && (
              <>
                <ul className="text-[11px] text-text-secondary space-y-1.5 list-disc list-inside mb-3">
                  <li><code className="bg-surface-2 px-1 rounded text-[10px]">POST /api/gateway/execute</code></li>
                  <li>Header: <code className="bg-surface-2 px-1 rounded text-[10px]">Authorization: Bearer wbl_ak_...</code></li>
                  <li>Body: <code className="bg-surface-2 px-1 rounded text-[10px]">{"{ action, params: { command, provider } }"}</code></li>
                </ul>
                <a href={SPEC_URL} download="wooblay-gateway-openapi.yaml" className="inline-flex items-center px-2.5 py-1.5 text-[11px] font-medium bg-accent/15 text-accent rounded-lg hover:bg-accent/25">
                  Download OpenAPI spec
                </a>
              </>
            )}
          </div>
        )}

        <p className="text-[10px] text-text-muted mt-4 pt-3 border-t border-border/50">
          Security model: API key → org → vault credentials; policy runs; action runs in an ephemeral container. Agent never sees secrets. Wire the gateway as the only path for credentialed actions.
        </p>
      </div>

      {/* Request full platform access — only when in firewall mode */}
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
              {unlockFullPlatformMut.isPending ? 'Unlocking…' : 'Unlock full platform'}
            </Button>
          </div>
          <p className="text-[10px] text-text-muted">
            Don’t have the password?{' '}
            <a href={X_HANDLE_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Reach out on X
            </a>
            {' '}— we’ll get you set up.
          </p>
        </div>
      )}
    </div>
  );
}
